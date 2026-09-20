import type { Clause, ClauseCategory, RiskLevel } from "@/lib/types";

/*
 * Gemini classification layer (Phase 3). Takes the clauses the deterministic
 * parser already found and returns them annotated with category, riskLevel,
 * and a plain-language explanation. This is the ONLY place the LLM is
 * involved before Phase 5 — it never decides where a clause starts or ends
 * (constraint 3 in AGENTS.md), and the prompt forbids it from adding
 * anything the clause's own words do not say (constraints 1 and 5).
 *
 * Calls are batched (default 25 clauses per request, sequential) to keep them
 * cheap and fast per AGENTS.md §7. Models: gemini-3.8-flash first, falling
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

const CATEGORIES: readonly ClauseCategory[] = [
  "rent",
  "deposit",
  "termination",
  "maintenance",
  "utilities",
  "renewal",
  "other",
];

const RISK_LEVELS: readonly RiskLevel[] = ["standard", "unusual", "risky"];

const SYSTEM_PROMPT = `You review clauses from a residential lease agreement in India for a tenant who is reading it before signing. For each clause you are given, return one JSON object with its id, a category, a risk level, and a plain-language explanation.

Rules you must follow:
- Base the explanation strictly on the wording of the clause provided. Never use general legal knowledge to add conditions, amounts, or consequences the clause does not state.
- Never invent a risk the clause's own words do not support.
- Write the explanation in simple language a non-lawyer can understand, in one or two sentences.
- category must be one of: rent, deposit, termination, maintenance, utilities, renewal, other.
- riskLevel must be "standard" when the clause reflects typical practice, "unusual" when it is noticeably one-sided or uncommon for a residential lease, or "risky" when it could cost the tenant money or rights (for example: forfeiting part of the deposit, waiving notice periods, open-ended charges).
- Respond only with JSON matching the given schema.`;

const RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      id: { type: "STRING" },
      category: { type: "STRING", enum: [...CATEGORIES] },
      riskLevel: { type: "STRING", enum: [...RISK_LEVELS] },
      explanation: { type: "STRING" },
    },
    required: ["id", "category", "riskLevel", "explanation"],
  },
} as const;

export interface ClassifyOptions {
  batchSize?: number;
}

interface GeminiClassification {
  id: string;
  category: ClauseCategory;
  riskLevel: RiskLevel;
  explanation: string;
}

function isCategory(value: unknown): value is ClauseCategory {
  return CATEGORIES.includes(value as ClauseCategory);
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return RISK_LEVELS.includes(value as RiskLevel);
}

async function classifyBatch(
  batch: Clause[],
  model: string,
  apiKey: string,
): Promise<Map<string, GeminiClassification>> {
  const prompt =
    "Classify the following lease clauses. Use the exact id given for each.\n\n" +
    batch.map((clause) => `id: ${clause.id}\n${clause.text}`).join("\n\n");

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
    throw new Error("Gemini returned malformed JSON for classification");
  }

  const results = new Map<string, GeminiClassification>();
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) continue;
      const { id, category, riskLevel, explanation } = entry as Record<string, unknown>;
      if (typeof id !== "string" || typeof explanation !== "string") continue;
      if (!isCategory(category) || !isRiskLevel(riskLevel)) continue;
      if (!results.has(id)) results.set(id, { id, category, riskLevel, explanation });
    }
  }
  return results;
}

export async function classifyClauses(
  clauses: Clause[],
  options: ClassifyOptions = {},
): Promise<Clause[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
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
        results = await classifyBatch(batch, model, apiKey);
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
