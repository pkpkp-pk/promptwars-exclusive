import { embedAll } from "@/lib/embeddings/embed";
import { cosineSimilarityNormed, l2Norm } from "@/lib/embeddings/similarity";
import { compareClauses, type AlignedPair } from "@/lib/gemini/compareClauses";
import { userFacingGeminiError } from "@/lib/gemini/client";
import { TYPE_LABELS } from "@/lib/documentTypes/config";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import {
  getClauses,
  getComparison,
  getDocument,
  getEmbeddings,
  setComparison,
  setEmbeddings,
} from "@/lib/store";
import type { Clause, ClauseDiff } from "@/lib/types";

/*
 * POST /api/compare — Phase 6, AGENTS2.md §7. Request: { docAId, docBId }.
 * Same-type only: 409 when the confirmed types differ — a cross-type diff is
 * nonsense output, not a degraded one. Clauses align within each shared
 * category by embedding similarity (greedy best-match); pairs then go to one
 * batched Gemini call that explains the material difference per pair.
 */

/** Two clauses in the same category pair up above this cosine score. */
const ALIGN_THRESHOLD = 0.5;

const COMPARE_LIMIT = 20;
const COMPARE_WINDOW_MS = 60 * 60 * 1000;

/** Clause embeddings are per-document and cached — see /api/ask. */
async function ensureEmbeddings(
  docId: string,
  clauses: Clause[],
): Promise<{ vectors: number[][]; norms: number[] }> {
  const cached = getEmbeddings(docId);
  if (cached) return cached;
  const vectors = await embedAll(clauses.map((clause) => clause.text));
  const norms = vectors.map(l2Norm);
  setEmbeddings(docId, vectors, norms);
  return { vectors, norms };
}

function errorResponse(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/** Greedy best-match alignment within one category. Pure after embeddings. */
function alignByCategory(
  clausesA: Clause[],
  clausesB: Clause[],
  vectorsA: number[][],
  vectorsB: number[][],
  normsA: number[],
  normsB: number[],
): AlignedPair[] {
  const pairs: AlignedPair[] = [];
  const usedB = new Set<number>();

  for (let i = 0; i < clausesA.length; i++) {
    let bestJ = -1;
    let bestScore = ALIGN_THRESHOLD;
    for (let j = 0; j < clausesB.length; j++) {
      if (usedB.has(j)) continue;
      const score = cosineSimilarityNormed(
        vectorsA[i]!,
        vectorsB[j]!,
        normsA[i]!,
        normsB[j]!,
      );
      if (score >= bestScore) {
        bestScore = score;
        bestJ = j;
      }
    }
    if (bestJ >= 0) {
      usedB.add(bestJ);
      pairs.push({
        category: clausesA[i]!.category ?? "other",
        docAText: clausesA[i]!.text,
        docBText: clausesB[bestJ]!.text,
      });
    } else {
      pairs.push({ category: clausesA[i]!.category ?? "other", docAText: clausesA[i]!.text });
    }
  }
  for (let j = 0; j < clausesB.length; j++) {
    if (!usedB.has(j)) {
      pairs.push({ category: clausesB[j]!.category ?? "other", docBText: clausesB[j]!.text });
    }
  }
  return pairs;
}

export async function POST(request: Request): Promise<Response> {
  let docAId: unknown;
  let docBId: unknown;
  try {
    const body = (await request.json()) as { docAId?: unknown; docBId?: unknown };
    docAId = body.docAId;
    docBId = body.docBId;
  } catch {
    return errorResponse(400, "Expected a JSON body with docAId and docBId.");
  }

  if (typeof docAId !== "string" || typeof docBId !== "string" || !docAId || !docBId) {
    return errorResponse(400, "Send both docAId and docBId from two uploads.");
  }
  if (docAId === docBId) {
    return errorResponse(400, "Pick two different documents to compare.");
  }

  const docA = getDocument(docAId);
  const docB = getDocument(docBId);
  if (!docA || !docB) {
    return errorResponse(
      404,
      "We couldn’t find one of those documents. It may have expired — upload both documents again.",
    );
  }

  if (!docA.confirmedType || !docB.confirmedType) {
    return errorResponse(
      409,
      "Both documents need a confirmed type before comparing — run the analysis step on each first.",
    );
  }
  if (docA.confirmedType !== docB.confirmedType) {
    return errorResponse(
      409,
      `These are different document types (${TYPE_LABELS[docA.confirmedType]} vs ${TYPE_LABELS[docB.confirmedType]}). Comparison only works within one type.`,
    );
  }

  const clausesA = getClauses(docAId);
  const clausesB = getClauses(docBId);
  if (!clausesA?.length || !clausesB?.length) {
    return errorResponse(422, "One of those documents has no clauses to compare.");
  }

  // A repeat compare of the same ordered pair is deterministic enough
  // (fixed texts, temperature 0.2) — serve the cached diff instead of
  // re-paying the alignment embeddings and the generation call.
  const cachedDiffs = getComparison(docAId, docBId);
  if (cachedDiffs) return Response.json({ diffs: cachedDiffs });

  if (!rateLimit("compare", clientIp(request), COMPARE_LIMIT, COMPARE_WINDOW_MS)) {
    return errorResponse(
      429,
      "Too many comparisons from your network — wait a while and try again.",
    );
  }

  if (!process.env.GEMINI_API_KEY) {
    return errorResponse(
      503,
      "Analysis isn’t configured on this deployment (GEMINI_API_KEY is missing).",
    );
  }

  try {
    // Per-document embedding caches — usually both hit after the first ask
    // or compare, so this costs zero embedding calls on repeats.
    const [{ vectors: vectorsA, norms: normsA }, { vectors: vectorsB, norms: normsB }] =
      await Promise.all([
        ensureEmbeddings(docAId, clausesA),
        ensureEmbeddings(docBId, clausesB),
      ]);

    // Align within each category; categories present in neither list produce
    // no pairs at all.
    const categories = new Set([
      ...clausesA.map((clause) => clause.category ?? "other"),
      ...clausesB.map((clause) => clause.category ?? "other"),
    ]);
    const pairs: AlignedPair[] = [];
    for (const category of categories) {
      const inA: Clause[] = [];
      const inB: Clause[] = [];
      const va: number[][] = [];
      const vb: number[][] = [];
      const na: number[] = [];
      const nb: number[] = [];
      clausesA.forEach((clause, i) => {
        if ((clause.category ?? "other") === category) {
          inA.push(clause);
          va.push(vectorsA[i]!);
          na.push(normsA[i]!);
        }
      });
      clausesB.forEach((clause, j) => {
        if ((clause.category ?? "other") === category) {
          inB.push(clause);
          vb.push(vectorsB[j]!);
          nb.push(normsB[j]!);
        }
      });
      pairs.push(...alignByCategory(inA, inB, va, vb, na, nb));
    }

    const diffs: ClauseDiff[] = await compareClauses(pairs, TYPE_LABELS[docA.confirmedType]);
    setComparison(docAId, docBId, diffs);
    return Response.json({ diffs });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    console.error("[/api/compare] Gemini call failed:", detail);
    return errorResponse(502, userFacingGeminiError(error));
  }
}
