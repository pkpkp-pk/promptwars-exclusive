import type { Clause, ClauseDiff, Document, DocumentType } from "@/lib/types";

/*
 * Session document store (AGENTS.md §3/§4): in-memory for the MVP, no
 * persistence. On serverless hosting each instance keeps its own map, which
 * is fine for the single-session demo flow; Firestore is a stretch goal only.
 *
 * Bounded: a warm instance would otherwise accumulate every uploaded
 * document (rawText + clauses + embeddings) forever. saveDocument evicts the
 * oldest upload past MAX_DOCUMENTS; comparisons are capped separately.
 */

interface StoredDocument {
  document: Document;
  clauses: Clause[];
  /*
   * Lazily computed clause embeddings with precomputed L2 norms. Clause
   * texts are immutable after upload, so /api/ask and /api/compare compute
   * these once per document instead of re-embedding the whole corpus per
   * request. Invalidated by updateClauses as defense-in-depth.
   */
  embeddings?: number[][];
  embeddingNorms?: number[];
}

const MAX_DOCUMENTS = 50;
const MAX_COMPARISONS = 100;

const documents = new Map<string, StoredDocument>();

/** Cached /api/compare results, keyed "docAId:docBId" (order-sensitive). */
const comparisons = new Map<string, ClauseDiff[]>();

function comparisonKey(docAId: string, docBId: string): string {
  return `${docAId}:${docBId}`;
}

function dropComparisonsFor(docId: string): void {
  for (const key of comparisons.keys()) {
    if (key.startsWith(`${docId}:`) || key.endsWith(`:${docId}`)) {
      comparisons.delete(key);
    }
  }
}

export function saveDocument(document: Document, clauses: Clause[]): void {
  documents.set(document.id, { document, clauses });
  while (documents.size > MAX_DOCUMENTS) {
    let oldestId: string | null = null;
    let oldestAt = "";
    for (const [id, stored] of documents) {
      if (id === document.id) continue;
      if (oldestId === null || stored.document.uploadedAt < oldestAt) {
        oldestId = id;
        oldestAt = stored.document.uploadedAt;
      }
    }
    if (oldestId === null) break;
    documents.delete(oldestId);
    dropComparisonsFor(oldestId);
  }
}

export function getDocument(docId: string): Document | undefined {
  return documents.get(docId)?.document;
}

export function getClauses(docId: string): Clause[] | undefined {
  return documents.get(docId)?.clauses;
}

/** Test helper / session reset: drops all stored documents. */
export function clearDocuments(): void {
  documents.clear();
  comparisons.clear();
}

/** Replaces the stored clause list for a document (e.g. classification results). */
export function updateClauses(docId: string, clauses: Clause[]): void {
  const stored = documents.get(docId);
  if (!stored) return;
  stored.clauses = clauses;
  // Texts are not expected to change, but if they ever do the cached vectors
  // and any diff built from them are stale.
  stored.embeddings = undefined;
  stored.embeddingNorms = undefined;
  dropComparisonsFor(docId);
}

/**
 * Stamps the user-confirmed document type on a stored document (AGENTS2.md
 * §2.4) — called by /api/classify once classification succeeds on that type.
 */
export function setConfirmedType(docId: string, confirmedType: DocumentType): void {
  const stored = documents.get(docId);
  if (stored) stored.document.confirmedType = confirmedType;
}

/** Cached clause embeddings + L2 norms for a document, if already computed. */
export function getEmbeddings(
  docId: string,
): { vectors: number[][]; norms: number[] } | undefined {
  const stored = documents.get(docId);
  if (!stored?.embeddings || !stored.embeddingNorms) return undefined;
  return { vectors: stored.embeddings, norms: stored.embeddingNorms };
}

export function setEmbeddings(docId: string, vectors: number[][], norms: number[]): void {
  const stored = documents.get(docId);
  if (!stored) return;
  stored.embeddings = vectors;
  stored.embeddingNorms = norms;
}

export function getComparison(docAId: string, docBId: string): ClauseDiff[] | undefined {
  return comparisons.get(comparisonKey(docAId, docBId));
}

export function setComparison(docAId: string, docBId: string, diffs: ClauseDiff[]): void {
  if (comparisons.size >= MAX_COMPARISONS) {
    // Insertion order ≈ age for this cache; drop the oldest entry.
    const oldestKey = comparisons.keys().next().value;
    if (oldestKey !== undefined) comparisons.delete(oldestKey);
  }
  comparisons.set(comparisonKey(docAId, docBId), diffs);
}
