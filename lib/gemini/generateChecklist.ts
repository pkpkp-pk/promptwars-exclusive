import type { ChecklistResult, Clause } from "@/lib/types";
import { FATAL_STATUSES, GeminiHttpError, generateJson, modelChain } from "./client";

/*
 * Checklist output (Phase 7, AGENTS2.md §7). One Gemini call over the
 * already-classified clause list — never a fresh document read. Risky and
 * unusual clauses become red flags; ambiguity becomes questions for a lawyer.
 * Every item must name its source clause by number so the output stays
 * traceable to the classified list instead of drifting into boilerplate
 * (Phase 7 acceptance criterion).
 */

const SYSTEM_PROMPT = `You prepare a pre-signing checklist for someone reviewing a legal document. You are given the document's classified clauses — each with its number, category, risk level, and a plain-language explanation.

Rules you must follow:
- redFlags: one short entry per clause that is unusual or risky. Start each entry with the clause number, e.g. "Clause 5: ...".
- questionsForLawyer: short questions the reader should ask a legal professional about anything ambiguous, missing, or open-ended in these clauses. Start each with the clause number when it relates to one, e.g. "Clause 3: ...".
- Base every entry strictly on the clauses provided. Never add generic checklist items that no clause supports.
- If nothing is unusual or risky, redFlags is an empty array — do not invent concerns.
- Respond only with JSON matching the given schema.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    redFlags: { type: "ARRAY", items: { type: "STRING" } },
    questionsForLawyer: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["redFlags", "questionsForLawyer"],
} as const;

async function checklistWithModel(
  clauses: Clause[],
  documentTypeName: string,
  model: string,
  retryDelays?: number[],
): Promise<ChecklistResult> {
  const prompt =
    `Build the checklist for this ${documentTypeName}.\n\n` +
    clauses
      .map(
        (clause) =>
          `Clause ${clause.order + 1} [${clause.category ?? "other"}, ${clause.riskLevel ?? "unreviewed"}]\n` +
          `${clause.text}\nExplanation: ${clause.explanation ?? "(none)"}`,
      )
      .join("\n\n");

  const text = await generateJson(
    { model, systemPrompt: SYSTEM_PROMPT, prompt, responseSchema: RESPONSE_SCHEMA },
    retryDelays,
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini returned malformed JSON for the checklist");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Gemini returned malformed JSON for the checklist");
  }

  const { redFlags, questionsForLawyer } = parsed as Record<string, unknown>;
  if (!Array.isArray(redFlags) || !Array.isArray(questionsForLawyer)) {
    throw new Error("Gemini returned an invalid checklist payload");
  }
  return {
    redFlags: redFlags.filter((item): item is string => typeof item === "string"),
    questionsForLawyer: questionsForLawyer.filter((item): item is string => typeof item === "string"),
  };
}

export async function generateChecklist(
  clauses: Clause[],
  documentTypeName: string,
  options?: { retryDelays?: number[] },
): Promise<ChecklistResult> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  let lastError: unknown;
  for (const model of modelChain()) {
    try {
      return await checklistWithModel(clauses, documentTypeName, model, options?.retryDelays);
    } catch (error) {
      if (error instanceof GeminiHttpError && FATAL_STATUSES.has(error.status)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
}
