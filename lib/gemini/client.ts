/*
 * Shared Gemini REST caller for the whole LLM layer (detectType,
 * classifyClauses, and later answerQuestion / compareClauses /
 * generateChecklist). Centralizes the things every caller used to duplicate:
 * the model chain (GEMINI_MODEL pins one model and disables the chain), the
 * fatal-vs-transient status split, error detail preservation, and — the point
 * of this module — retry with backoff on transient failures.
 *
 * Transient statuses (429 quota, 5xx, network errors) get retried on the same
 * model with a short backoff before the caller's chain advances to the next
 * model: Gemini's free tier returns brief 503 "high demand" spikes that a
 * single retry usually absorbs, and a spike used to surface as a user-facing
 * 502 on the first attempt. Key- and request-level failures (400/401/403)
 * fail identically on every model and every retry, so they throw immediately
 * with the API's own message.
 */

export const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const MODEL_CHAIN = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"];

/** Fail fast on these — retrying or switching models cannot help. */
export const FATAL_STATUSES = new Set([400, 401, 403]);

/** Retryable: quota windows and server-side hiccups clear on their own. */
export const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

export class GeminiHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GeminiHttpError";
  }
}

/** The model list for one logical call, honoring an operator's GEMINI_MODEL pin. */
export function modelChain(): string[] {
  return process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : MODEL_CHAIN;
}

const DEFAULT_RETRY_DELAYS_MS = [750, 2250];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GeminiJsonRequest {
  model: string;
  systemPrompt: string;
  prompt: string;
  responseSchema: unknown;
}

/**
 * Runs `fn` with backoff retries on transient failures. Fatal statuses throw
 * immediately; non-transient HTTP statuses (e.g. 404 model gone) also throw
 * immediately so a caller's model chain advances without burning retries on a
 * permanent failure. Network-level throws (no status) are retried.
 */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  retryDelays: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    if (attempt > 0) await sleep(retryDelays[attempt - 1]!);
    try {
      return await fn();
    } catch (error) {
      if (error instanceof GeminiHttpError && !TRANSIENT_STATUSES.has(error.status)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * One structured-output call against one model, with backoff retries on
 * transient failures. Returns the model's concatenated text parts (already
 * JSON per responseMimeType); parsing and validation stay with the caller,
 * which decides whether a malformed answer means "try the next model".
 */
export async function generateJson(
  request: GeminiJsonRequest,
  retryDelays: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return withTransientRetry(() => generateOnce(request, apiKey), retryDelays);
}

async function generateOnce(request: GeminiJsonRequest, apiKey: string): Promise<string> {
  const response = await fetch(`${API_BASE}/${request.model}:generateContent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: request.systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: request.prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: request.responseSchema,
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
  return (data.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("");
}

/**
 * Turns a Gemini-layer failure into the message a route returns. 429 means
 * the deployment's quota is exhausted — retrying in a second is pointless —
 * while 503 is a transient demand spike worth an immediate retry. Lumping
 * both under "couldn't be reached" told users to retry a quota error for
 * hours, so the wording is split here once for every route.
 *
 * The upstream API's own message stays in server logs only: it can name
 * internal models/config and echo request content, none of which belongs in
 * a user-facing body.
 */
export function userFacingGeminiError(error: unknown): string {
  const status = error instanceof GeminiHttpError ? error.status : undefined;
  if (status === 429) {
    return "The analysis service's usage limit is reached for now. This usually resets within a day on the free tier — try again later.";
  }
  if (status !== undefined && TRANSIENT_STATUSES.has(status)) {
    return "The analysis service is temporarily busy. Please try again in a moment.";
  }
  return "The analysis service couldn’t be reached. Please try again.";
}
