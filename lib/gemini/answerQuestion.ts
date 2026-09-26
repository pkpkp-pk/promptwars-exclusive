import type { Clause } from "@/lib/types";
import { FATAL_STATUSES, GeminiHttpError, generateJson, modelChain } from "./client";

/*
 * Grounded Q&A (Phase 5, AGENTS2.md §9). The model only ever sees the clause
 * excerpts retrieval selected — never the whole document, never its own
 * legal knowledge. The prompt forces an explicit ungrounded answer when the
 * excerpts don't cover the question, and forces citedClauseIds on every
 * grounded answer (constraints 1 and 2).
 */

const SYSTEM_PROMPT = `You answer questions about a legal document for someone deciding whether to sign it. You are given only excerpts of the document — clauses retrieved as relevant to the question.

Rules you must follow:
- Answer only from the provided excerpts. Never use general legal knowledge to fill gaps.
- If the excerpts do not cover the question, set grounded to false and make the answer a short statement that the document does not address this, with a suggestion to consult a qualified legal professional.
- When grounded is true, citedClauseIds must list the id of every excerpt your answer draws from. Never cite an excerpt you did not use.
- Keep the answer to two or three sentences of plain language.
- Respond only with JSON matching the given schema.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    grounded: { type: "BOOLEAN" },
    answer: { type: "STRING" },
    citedClauseIds: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["grounded", "answer", "citedClauseIds"],
} as const;

export interface QAAnswer {
  grounded: boolean;
  answer: string;
  citedClauseIds: string[];
}

async function answerWithModel(
  question: string,
  excerpts: Clause[],
  model: string,
  retryDelays?: number[],
): Promise<QAAnswer> {
  const prompt =
    "Question: " +
    question +
    "\n\nExcerpts:\n\n" +
    excerpts.map((clause) => `id: ${clause.id}\n${clause.text}`).join("\n\n");

  const text = await generateJson(
    { model, systemPrompt: SYSTEM_PROMPT, prompt, responseSchema: RESPONSE_SCHEMA },
    retryDelays,
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini returned malformed JSON for question answering");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Gemini returned malformed JSON for question answering");
  }

  const { grounded, answer, citedClauseIds } = parsed as Record<string, unknown>;
  if (typeof grounded !== "boolean" || typeof answer !== "string" || !Array.isArray(citedClauseIds)) {
    throw new Error("Gemini returned an invalid Q&A payload");
  }

  // Citations are only meaningful if they name excerpts the model actually
  // saw — drop anything else rather than show a fabricated reference.
  const validIds = new Set(excerpts.map((clause) => clause.id));
  const citations = citedClauseIds.filter(
    (id): id is string => typeof id === "string" && validIds.has(id),
  );
  return { grounded, answer, citedClauseIds: citations };
}

export async function answerQuestion(
  question: string,
  excerpts: Clause[],
  options?: { retryDelays?: number[] },
): Promise<QAAnswer> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  let lastError: unknown;
  for (const model of modelChain()) {
    try {
      return await answerWithModel(question, excerpts, model, options?.retryDelays);
    } catch (error) {
      if (error instanceof GeminiHttpError && FATAL_STATUSES.has(error.status)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
}
