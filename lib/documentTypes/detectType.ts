import type { DocumentType } from "@/lib/types";

/*
 * Document-type detection (AGENTS2.md §7 upload contract, §9 prompt
 * guidelines). One Gemini call over the extracted text that returns a
 * suggested type plus confidence. The suggestion is only ever shown to the
 * user for confirmation — classification uses the confirmed type, so a
 * misdetection never changes which taxonomy runs silently (constraint 4).
 *
 * Structure deliberately mirrors lib/gemini/classifyClauses.ts: same model
 * chain (GEMINI_MODEL pins a single model and disables the chain), same key
 * handling, same fatal-status short-circuit so key-level failures fail fast
 * with the API's own reason. A malformed or invalid suggestion is treated
 * like any other model failure and retried on the next model — it is never
 * coerced into a supported type.
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL_CHAIN = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"];

// Detection only needs the document's opening — title, parties, first
// clauses. A fixed prefix keeps the single call cheap and inside the model's
// context window even for large uploads.
const MAX_TEXT_CHARS = 20_000;

const FATAL_STATUSES = new Set([400, 401, 403]);

class GeminiHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GeminiHttpError";
  }
}

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
  apiKey: string,
): Promise<TypeSuggestion> {
  const prompt =
    "Identify the type of the following document.\n\n" +
    rawText.slice(0, MAX_TEXT_CHARS);

  const response = await fetch(`${API_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  if (!response.ok) {
    // Keep the API's own reason (e.g. "API key not valid") — it's what makes
    // a production failure diagnosable from the route's logs and error body.
    let detail = "";
    try {
      const text = await response.text();
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) detail = `: ${parsed.error.message.slice(0, 200)}`;
    } catch {
      // Non-JSON error body — the status alone is still thrown.
    }
    throw new GeminiHttpError(
      response.status,
      `Gemini API request failed with status ${response.status}${detail}`,
    );
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("");

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

export async function detectType(rawText: string): Promise<TypeSuggestion> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  // An explicitly pinned model is an operator decision — use it alone.
  const chain: string[] = process.env.GEMINI_MODEL
    ? [process.env.GEMINI_MODEL]
    : MODEL_CHAIN;

  let lastError: unknown;
  for (const model of chain) {
    try {
      return await detectWithModel(rawText, model, apiKey);
    } catch (error) {
      if (error instanceof GeminiHttpError && FATAL_STATUSES.has(error.status)) {
        throw error; // identical failure on every model — no point continuing
      }
      lastError = error;
    }
  }
  throw lastError;
}
