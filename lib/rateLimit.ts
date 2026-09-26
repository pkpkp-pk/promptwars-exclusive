/*
 * Per-IP fixed-window rate limiter for the API routes. Every route is
 * unauthenticated and spends the shared Gemini key, so an anonymous loop
 * would otherwise exhaust the daily quota (or the instance's memory via
 * /api/upload) for every user of the deployment.
 *
 * In-memory, like the document store: per Vercel instance, which is the
 * right granularity for the demo. Post-hackathon this becomes Vercel KV.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Hard cap on tracked keys so the limiter itself can't be flooded. */
const MAX_BUCKETS = 5000;

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Returns true when the call is allowed, false when the window's limit is
 * exhausted. `scope` separates limits per route so chat and upload don't
 * share one budget.
 */
export function rateLimit(
  scope: string,
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const id = `${scope}:${key}`;
  let bucket = buckets.get(id);
  if (!bucket || bucket.resetAt <= now) {
    if (!bucket && buckets.size >= MAX_BUCKETS) {
      // Sweep expired entries; if still full, drop oldest by resetAt.
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      if (buckets.size >= MAX_BUCKETS) {
        let oldestKey: string | undefined;
        let oldestReset = Infinity;
        for (const [k, b] of buckets) {
          if (b.resetAt < oldestReset) {
            oldestReset = b.resetAt;
            oldestKey = k;
          }
        }
        if (oldestKey !== undefined) buckets.delete(oldestKey);
      }
    }
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(id, bucket);
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

/** Test hook. */
export function clearRateLimits(): void {
  buckets.clear();
}
