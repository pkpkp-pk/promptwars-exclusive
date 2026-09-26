/*
 * In-memory cosine similarity (AGENTS2.md §5 — no vector DB for the MVP).
 */

export function cosineSimilarity(a: number[], b: number[]): number {
  return cosineSimilarityNormed(a, b, l2Norm(a), l2Norm(b));
}

export function l2Norm(v: number[]): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!;
  return Math.sqrt(sum);
}

/*
 * Cosine similarity with precomputed L2 norms. Hot loops (/api/ask ranking,
 * /api/compare's O(nA×nB) alignment) compute each vector's norm once instead
 * of per pair — one pass per vector, no per-pair sqrt.
 */
export function cosineSimilarityNormed(
  a: number[],
  b: number[],
  normA: number,
  normB: number,
): number {
  if (a.length !== b.length || a.length === 0) return 0;
  if (normA === 0 || normB === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot / (normA * normB);
}
