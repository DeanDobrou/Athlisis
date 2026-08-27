const hits = new Map<string, { count: number; resetAt: number }>();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const MAX_KEYS = 10_000;
// Evicting only back to the cap would re-run the O(n) sweep on every single
// insert that follows. Trimming to a low-water mark amortises it instead.
const EVICT_TO = 9_000;
const MAX_KEY_CHARS = 256;

let sweeps = 0;

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export function rateLimit(key: string, now = Date.now()): RateLimitResult {
  // Callers build keys from request input (a 1MB email is a valid form
  // post). Truncation can only merge buckets, which is stricter, never looser.
  key = key.slice(0, MAX_KEY_CHARS);
  const entry = hits.get(key);

  if (!entry || now > entry.resetAt) {
    if (hits.size >= MAX_KEYS) {
      sweeps++;
      for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
      // Still full: someone is minting fresh keys inside one window. Evict
      // oldest-inserted (Map iterates in insertion order) to stay bounded.
      // ponytail: an attacker filling 10k keys can reset a victim bucket
      // early; the alternative (refusing inserts) locks real users out
      // instead, which is worse for a login form.
      for (const k of hits.keys()) {
        if (hits.size <= EVICT_TO) break;
        hits.delete(k);
      }
    }
    hits.delete(key); // re-insert at the tail so eviction order tracks recency
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function clearRateLimit(key: string): void {
  hits.delete(key);
}

if ((import.meta as { main?: boolean }).main) {
  const check = (ok: boolean, msg: string) => {
    if (!ok) throw new Error(msg);
  };
  const t0 = 1_000_000;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    check(rateLimit("a", t0).allowed, `attempt ${i + 1} should be allowed`);
  }
  check(!rateLimit("a", t0).allowed, "attempt over the cap must be blocked");
  check(rateLimit("b", t0).allowed, "a different key must be unaffected");

  const blocked = rateLimit("a", t0);
  check(
    blocked.retryAfterSeconds > 0 &&
      blocked.retryAfterSeconds <= WINDOW_MS / 1000,
    "blocked result must report a sane retry delay",
  );

  check(
    rateLimit("a", t0 + WINDOW_MS + 1).allowed,
    "the window must expire and let the key through again",
  );

  clearRateLimit("c");
  for (let i = 0; i < MAX_ATTEMPTS; i++) rateLimit("c", t0);
  check(!rateLimit("c", t0).allowed, "key c should be blocked");
  clearRateLimit("c");
  check(rateLimit("c", t0).allowed, "clearRateLimit must reset the counter");

  const longA = "x".repeat(MAX_KEY_CHARS) + "-variant-a";
  const longB = "x".repeat(MAX_KEY_CHARS) + "-variant-b";
  for (let i = 0; i < MAX_ATTEMPTS; i++) rateLimit(longA, t0);
  check(
    !rateLimit(longB, t0).allowed,
    "keys differing only past the length cap must share a bucket",
  );

  const sweepsBefore = sweeps;
  for (let i = 0; i < MAX_KEYS + 100; i++) rateLimit(`evict-${i}`, t0);
  check(
    hits.size <= MAX_KEYS,
    "flooding fresh keys inside one window must not grow the map unbounded",
  );
  check(
    sweeps - sweepsBefore >= 1,
    "the flood must actually trigger eviction, or the next check proves nothing",
  );
  check(
    sweeps - sweepsBefore <= 5,
    "eviction must trim to the low-water mark; trimming only to the cap makes " +
      "every later insert re-run the full sweep",
  );

  console.log("rate-limit self-check passed");
}
