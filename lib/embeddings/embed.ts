/*
 * Gemini embeddings for grounded Q&A retrieval (Phase 5). One batched
 * :batchEmbedContents call per embedAll() — never one request per text.
 * Model chain and transient-retry semantics match the generation layer
 * (lib/gemini/client.ts); GEMINI_EMBED_MODEL pins a single model.
 */

import { API_BASE, GeminiHttpError, withTransientRetry } from "@/lib/gemini/client";

const EMBED_CHAIN = ["gemini-embedding-001", "text-embedding-004"];

function embedChain(): string[] {
  return process.env.GEMINI_EMBED_MODEL
    ? [process.env.GEMINI_EMBED_MODEL]
    : EMBED_CHAIN;
}

async function embedBatchWithModel(
  texts: string[],
  model: string,
  apiKey: string,
  retryDelays?: readonly number[],
): Promise<number[][]> {
  return withTransientRetry(async () => {
    const response = await fetch(`${API_BASE}/${model}:batchEmbedContents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
        })),
      }),
    });

    if (!response.ok) {
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
      embeddings?: { values?: number[] }[];
    };
    const vectors = (data.embeddings ?? []).map((entry) => entry.values ?? []);
    if (vectors.length !== texts.length || vectors.some((v) => v.length === 0)) {
      // Short or empty embedding list — treat like any model failure so the
      // chain advances; never return partial vectors the caller can't place.
      throw new Error("Gemini returned an incomplete embedding batch");
    }
    return vectors;
  }, retryDelays);
}

/*
 * Gemini caps batchEmbedContents at 100 entries per request — a larger
 * document would fail permanently with a fatal 400. Chunk above that.
 */
const MAX_BATCH_TEXTS = 100;

/** Embeds every text, chunking into ≤100-entry batched calls. */
export async function embedAll(
  texts: string[],
  options?: { retryDelays?: number[] },
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const chunks: string[][] = [];
  for (let start = 0; start < texts.length; start += MAX_BATCH_TEXTS) {
    chunks.push(texts.slice(start, start + MAX_BATCH_TEXTS));
  }

  let lastError: unknown;
  for (const model of embedChain()) {
    try {
      const results: number[][] = [];
      for (const chunk of chunks) {
        results.push(
          ...(await embedBatchWithModel(chunk, model, apiKey, options?.retryDelays)),
        );
      }
      return results;
    } catch (error) {
      if (
        error instanceof GeminiHttpError &&
        [400, 401, 403].includes(error.status)
      ) {
        throw error; // key-level failure — identical on every model
      }
      lastError = error;
    }
  }
  throw lastError;
}
