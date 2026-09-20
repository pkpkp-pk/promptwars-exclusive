import type { Clause, Document, DocumentType } from "@/lib/types";

/*
 * Session document store (AGENTS.md §3/§4): in-memory for the MVP, no
 * persistence. On serverless hosting each instance keeps its own map, which
 * is fine for the single-session demo flow; Firestore is a stretch goal only.
 */

interface StoredDocument {
  document: Document;
  clauses: Clause[];
}

const documents = new Map<string, StoredDocument>();

export function saveDocument(document: Document, clauses: Clause[]): void {
  documents.set(document.id, { document, clauses });
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
}

/** Replaces the stored clause list for a document (e.g. classification results). */
export function updateClauses(docId: string, clauses: Clause[]): void {
  const stored = documents.get(docId);
  if (stored) stored.clauses = clauses;
}

/**
 * Stamps the user-confirmed document type on a stored document (AGENTS2.md
 * §2.4) — called by /api/classify once classification succeeds on that type.
 */
export function setConfirmedType(docId: string, confirmedType: DocumentType): void {
  const stored = documents.get(docId);
  if (stored) stored.document.confirmedType = confirmedType;
}
