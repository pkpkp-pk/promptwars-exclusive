import { embedAll } from "@/lib/embeddings/embed";
import { cosineSimilarityNormed, l2Norm } from "@/lib/embeddings/similarity";
import { answerQuestion } from "@/lib/gemini/answerQuestion";
import { userFacingGeminiError } from "@/lib/gemini/client";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { getClauses, getDocument, getEmbeddings, setEmbeddings } from "@/lib/store";
import type { Clause, QAExchange } from "@/lib/types";

/*
 * POST /api/ask — Phase 5, AGENTS2.md §7. Request: { docId, question }.
 * Embeds the question and the stored clauses in one batched call, takes the
 * top-k by cosine similarity, and only then spends a generation call. If the
 * best similarity is below GROUNDED_THRESHOLD, no generation call happens at
 * all — the static not-addressed answer returns with grounded: false
 * (constraint 2: never let the model guess from outside the document).
 */

const TOP_K = 5;
const GROUNDED_THRESHOLD = 0.45;
const MAX_QUESTION_CHARS = 1000;

/** Per-IP chat budget: each grounded question can spend a generation call. */
const ASK_LIMIT = 60;
const ASK_WINDOW_MS = 60 * 60 * 1000;

/**
 * Clause texts are immutable after upload, so their embeddings are computed
 * once per document and cached in the store — a chat question costs one
 * embedding (its own), not N+1 for the whole corpus.
 */
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

const NOT_ADDRESSED_ANSWER =
  "This document doesn’t address that question. For anything it doesn’t cover, consult a qualified legal professional before you sign.";

function errorResponse(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let docId: unknown;
  let question: unknown;
  try {
    const body = (await request.json()) as { docId?: unknown; question?: unknown };
    docId = body.docId;
    question = body.question;
  } catch {
    return errorResponse(400, "Expected a JSON body with a docId and question.");
  }

  if (typeof docId !== "string" || docId.length === 0) {
    return errorResponse(400, "Which document? Send the docId from the upload.");
  }

  if (typeof question !== "string" || question.trim().length === 0) {
    return errorResponse(400, "Ask a question about the document first.");
  }
  const trimmedQuestion = question.trim().slice(0, MAX_QUESTION_CHARS);

  if (!getDocument(docId)) {
    return errorResponse(
      404,
      "We couldn’t find that document. It may have expired — upload your document again.",
    );
  }

  const clauses = getClauses(docId);
  if (!clauses || clauses.length === 0) {
    return errorResponse(422, "That document has no clauses to search.");
  }

  if (!rateLimit("ask", clientIp(request), ASK_LIMIT, ASK_WINDOW_MS)) {
    return errorResponse(
      429,
      "Too many questions from your network — wait a while and try again.",
    );
  }

  if (!process.env.GEMINI_API_KEY) {
    return errorResponse(
      503,
      "Analysis isn’t configured on this deployment (GEMINI_API_KEY is missing).",
    );
  }

  try {
    const [{ vectors: clauseVectors, norms: clauseNorms }, [questionVector]] =
      await Promise.all([
        ensureEmbeddings(docId, clauses),
        embedAll([trimmedQuestion]),
      ]);
    const questionNorm = l2Norm(questionVector!);

    const ranked = clauses
      .map((clause, index) => ({
        clause,
        score: cosineSimilarityNormed(
          questionVector!,
          clauseVectors[index]!,
          questionNorm,
          clauseNorms[index]!,
        ),
      }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best || best.score < GROUNDED_THRESHOLD) {
      // Retrieval found nothing close — skip the generation call entirely.
      const exchange: QAExchange = {
        question: trimmedQuestion,
        answer: NOT_ADDRESSED_ANSWER,
        citedClauseIds: [],
        grounded: false,
      };
      return Response.json(exchange);
    }

    const excerpts = ranked.slice(0, TOP_K).map((entry) => entry.clause);
    const answer = await answerQuestion(trimmedQuestion, excerpts);

    const exchange: QAExchange = {
      question: trimmedQuestion,
      answer: answer.answer,
      citedClauseIds: answer.citedClauseIds,
      grounded: answer.grounded,
    };
    return Response.json(exchange);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    console.error("[/api/ask] Gemini call failed:", detail);
    return errorResponse(502, userFacingGeminiError(error));
  }
}
