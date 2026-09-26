import type { DocumentType } from "@/lib/types";
import { FATAL_STATUSES, GeminiHttpError, generateJson, modelChain } from "@/lib/gemini/client";

/*
 * Document-type detection (AGENTS2.md §7 upload contract, §9 prompt
 * guidelines). One Gemini call over the extracted text that returns a
 * suggested type plus confidence. The suggestion is only ever shown to the
 * user for confirmation — classification uses the confirmed type, so a
 * misdetection never changes which taxonomy runs silently (constraint 4).
 *
 * Model chain, transient retry, and the fatal-status short-circuit live in
 * lib/gemini/client. A malformed or invalid suggestion is treated like any
 * other model failure and falls to the next model — it is never coerced into
 * a supported type.
 */

// Detection only needs the document's opening — title, parties, first
// clauses. A fixed prefix keeps the single call cheap and inside the model's
// context window even for large uploads.
const MAX_TEXT_CHARS = 20_000;

const DOCUMENT_TYPES: readonly DocumentType[] = [
  "lease",
  "freelance_contract",
  "tos_privacy_policy",
  "nda",
  "employment_offer",
];

const SUGGESTIONS: readonly (DocumentType | "none_of_these")[] = [
  ...DOCUMENT_TYPES,
  "none_of_these",
];

const SYSTEM_PROMPT = `You identify what kind of document someone has uploaded before a tool reviews it with them. You are given the document's text.

Rules you must follow:
- Choose exactly one of: lease (a residential rental or lease agreement between a landlord and a tenant), freelance_contract (a services contract between a freelancer or contractor and a client), tos_privacy_policy (terms of service or a privacy policy for an app, website, or service), nda (a non-disclosure or confidentiality agreement), employment_offer (a job offer letter or employment agreement from an employer to a candidate), or none_of_these.
- Never force-fit. If the document is not genuinely one of the five supported types, return none_of_these.
- Decide only from the document text provided, not from assumptions about the file or who uploaded it.
- confidence is a number from 0 to 1 showing how certain the choice is.
- Respond only with JSON matching the given schema.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    documentType: { type: "STRING", enum: [...SUGGESTIONS] },
    confidence: { type: "NUMBER" },
  },
  required: ["documentType", "confidence"],
} as const;

export interface TypeSuggestion {
  suggestedType: DocumentType | "none_of_these";
  confidence: number; // 0-1
}

function isSuggestion(value: unknown): value is DocumentType | "none_of_these" {
  return SUGGESTIONS.includes(value as DocumentType | "none_of_these");
}

async function detectWithModel(
  rawText: string,
  model: string,
  retryDelays?: number[],
): Promise<TypeSuggestion> {
  const prompt =
    "Identify the type of the following document.\n\n" +
    rawText.slice(0, MAX_TEXT_CHARS);

  const text = await generateJson(
    { model, systemPrompt: SYSTEM_PROMPT, prompt, responseSchema: RESPONSE_SCHEMA },
    retryDelays,
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini returned malformed JSON for type detection");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Gemini returned malformed JSON for type detection");
  }

  const { documentType, confidence } = parsed as Record<string, unknown>;
  if (!isSuggestion(documentType) || typeof confidence !== "number") {
    // Out-of-enum type or non-numeric confidence — never coerced into a
    // suggestion; surfaced as a model failure so the next model is tried.
    throw new Error("Gemini returned an invalid type suggestion");
  }
  return { suggestedType: documentType, confidence };
}

export async function detectType(
  rawText: string,
  options?: { retryDelays?: number[] },
): Promise<TypeSuggestion> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  let lastError: unknown;
  for (const model of modelChain()) {
    try {
      return await detectWithModel(rawText, model, options?.retryDelays);
    } catch (error) {
      if (error instanceof GeminiHttpError && FATAL_STATUSES.has(error.status)) {
        throw error; // identical failure on every model — no point continuing
      }
      lastError = error;
    }
  }
  throw lastError;
}
