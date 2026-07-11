/**
 * Simple sliding-window rate limiter.
 * Tracks request counts per key (IP, session ID, etc.) within a time window.
 */
export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;

    // Cleanup expired entries every minute
    setInterval(() => this.cleanup(), 60_000);
  }

  /**
   * Check if a request is allowed. Returns true if under the limit.
   */
  check(key: string): boolean {
    const now = Date.now();
    const entry = this.windows.get(key);

    if (!entry || now > entry.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    entry.count++;
    return entry.count <= this.maxRequests;
  }

  /**
   * Get remaining requests for a key.
   */
  remaining(key: string): number {
    const now = Date.now();
    const entry = this.windows.get(key);
    if (!entry || now > entry.resetAt) return this.maxRequests;
    return Math.max(0, this.maxRequests - entry.count);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.windows) {
      if (now > entry.resetAt) this.windows.delete(key);
    }
  }
}
