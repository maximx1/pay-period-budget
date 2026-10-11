type Bucket = { count: number; resetAt: number };

/**
 * Fixed-window, in-memory attempt counter. Good enough for a single-process deployment;
 * swap for a shared store if the API ever runs as more than one instance.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Seconds until `key` may try again, or 0 if it is not blocked. */
  retryAfterSeconds(key: string): number {
    const bucket = this.current(key);
    if (!bucket || bucket.count < this.limit) return 0;
    return Math.ceil((bucket.resetAt - this.now()) / 1000);
  }

  hit(key: string): void {
    const bucket = this.current(key);
    if (bucket) {
      bucket.count += 1;
      return;
    }
    if (this.buckets.size > 10_000) this.prune();
    this.buckets.set(key, { count: 1, resetAt: this.now() + this.windowMs });
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private current(key: string): Bucket | undefined {
    const bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt <= this.now()) {
      this.buckets.delete(key);
      return undefined;
    }
    return bucket;
  }

  private prune(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
