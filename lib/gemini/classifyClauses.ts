import type { Clause, RiskLevel } from "@/lib/types";

/*
 * Gemini classification layer (Phase 3). Takes the clauses the deterministic
 * parser already found and returns them annotated with category, riskLevel,
 * and a plain-language explanation. This is the ONLY place the LLM is
 * involved before Phase 5 — it never decides where a clause starts or ends
 * (constraint 3 in AGENTS2.md), and the prompt forbids it from adding
 * anything the clause's own words do not say (constraints 1 and 5).
 *
 * The caller supplies the category taxonomy for the document's confirmed type
 * (CATEGORY_MAP in /lib/documentTypes/config.ts) plus the type's display name,
 * so the same code classifies any of the five supported document types — no
 * category list or document-type wording is baked in here.
 *
 * Calls are batched (default 25 clauses per request, sequential) to keep them
 * cheap and fast per AGENTS2.md §7. Models: gemini-3.8-flash first, falling
 * back to gemini-3.7-flash then gemini-3.6-flash on model-level failures
 * (unavailable, rate-limited, server errors). Key- and request-level
 * failures (400/401/403) fail identically on every model, so they fail fast
 * with the full diagnostic instead of burning the chain. Setting GEMINI_MODEL
 * pins a single model and disables the chain.
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL_CHAIN = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"];
export const DEFAULT_BATCH_SIZE = 25;

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

const RISK_LEVELS: readonly RiskLevel[] = ["standard", "unusual", "risky"];

function buildSystemPrompt(
  categories: readonly string[],
  documentTypeName: string,
): string {
  return `You review clauses from a ${documentTypeName} for someone who is reading it before agreeing to it. For each clause you are given, return one JSON object with its id, a category, a risk level, and a plain-language explanation.

Rules you must follow:
- Base the explanation strictly on the wording of the clause provided. Never use general legal knowledge to add conditions, amounts, or consequences the clause does not state.
- Never invent a risk the clause's own words do not support.
- Write the explanation in simple language a non-lawyer can understand, in one or two sentences.
- category must be one of: ${categories.join(", ")}. Never invent a category outside this list.
- riskLevel must be "standard" when the clause reflects typical practice, "unusual" when it is noticeably one-sided or uncommon for this kind of document, or "risky" when it could cost the reader money or rights (for example: forfeiting money already paid, giving up a right without compensation, open-ended charges).
- Respond only with JSON matching the given schema.`;
}

function buildResponseSchema(categories: readonly string[]) {
  return {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        id: { type: "STRING" },
        category: { type: "STRING", enum: [...categories] },
        riskLevel: { type: "STRING", enum: [...RISK_LEVELS] },
        explanation: { type: "STRING" },
      },
      required: ["id", "category", "riskLevel", "explanation"],
    },
  };
}

export interface ClassifyOptions {
  /** Category taxonomy for the document's confirmed type (CATEGORY_MAP[type]). */
  categories: string[];
  /** Display name of the document type, e.g. "Non-disclosure agreement". */
  documentTypeName: string;
  batchSize?: number;
}

/** Everything a batch request needs that is fixed for the whole call. */
interface ClassificationContext {
  categories: readonly string[];
  systemPrompt: string;
  responseSchema: ReturnType<typeof buildResponseSchema>;
}

interface GeminiClassification {
  id: string;
  category: string;
  riskLevel: RiskLevel;
  explanation: string;
}

function isCategory(value: unknown, categories: readonly string[]): value is string {
  return typeof value === "string" && categories.includes(value);
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return RISK_LEVELS.includes(value as RiskLevel);
}

async function classifyBatch(
  batch: Clause[],
  model: string,
  apiKey: string,
  context: ClassificationContext,
): Promise<Map<string, GeminiClassification>> {
  const prompt =
    "Classify the following clauses. Use the exact id given for each.\n\n" +
    batch.map((clause) => `id: ${clause.id}\n${clause.text}`).join("\n\n");

  const response = await fetch(`${API_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: context.systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: context.responseSchema,
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
    throw new Error("Gemini returned malformed JSON for classification");
  }

  const results = new Map<string, GeminiClassification>();
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) continue;
      const { id, category, riskLevel, explanation } = entry as Record<string, unknown>;
      if (typeof id !== "string" || typeof explanation !== "string") continue;
      if (!isCategory(category, context.categories) || !isRiskLevel(riskLevel)) continue;
      if (!results.has(id)) results.set(id, { id, category, riskLevel, explanation });
    }
  }
  return results;
}

export async function classifyClauses(
  clauses: Clause[],
  options: ClassifyOptions,
): Promise<Clause[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const context: ClassificationContext = {
    categories: options.categories,
    systemPrompt: buildSystemPrompt(options.categories, options.documentTypeName),
    responseSchema: buildResponseSchema(options.categories),
  };
  // An explicitly pinned model is an operator decision — use it alone.
  const chain: string[] = process.env.GEMINI_MODEL
    ? [process.env.GEMINI_MODEL]
    : MODEL_CHAIN;
  const byId = new Map<string, GeminiClassification>();

  // Once a model works, try it first for the remaining batches.
  let preferredModel: string | null = null;

  for (let start = 0; start < clauses.length; start += batchSize) {
    const batch = clauses.slice(start, start + batchSize);
    const order: string[] = preferredModel
      ? [preferredModel, ...chain.filter((model) => model !== preferredModel)]
      : chain;

    let lastError: unknown;
    let results: Map<string, GeminiClassification> | null = null;
    for (const model of order) {
      try {
        results = await classifyBatch(batch, model, apiKey, context);
        preferredModel = model;
        break;
      } catch (error) {
        if (error instanceof GeminiHttpError && FATAL_STATUSES.has(error.status)) {
          throw error; // identical failure on every model — no point continuing
        }
        lastError = error;
      }
    }
    if (!results) throw lastError;

    for (const [id, result] of results) byId.set(id, result);
  }

  return clauses.map((clause) => {
    const result = byId.get(clause.id);
    return result
      ? {
          ...clause,
          category: result.category,
          riskLevel: result.riskLevel,
          explanation: result.explanation,
        }
      : clause;
  });
}
