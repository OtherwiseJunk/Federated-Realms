import { describe, expect, test } from "bun:test";
import { RateLimiter } from "./rate-limiter.js";

describe("RateLimiter", () => {
  test("allows requests under the limit", () => {
    const limiter = new RateLimiter(3, 60_000);
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(true);
  });

  test("blocks requests over the limit", () => {
    const limiter = new RateLimiter(2, 60_000);
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(false);
  });

  test("tracks keys independently", () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user2")).toBe(true);
    expect(limiter.check("user1")).toBe(false);
    expect(limiter.check("user2")).toBe(false);
  });

  test("remaining reports correct quota", () => {
    const limiter = new RateLimiter(5, 60_000);
    expect(limiter.remaining("user1")).toBe(5);
    limiter.check("user1");
    limiter.check("user1");
    expect(limiter.remaining("user1")).toBe(3);
  });

  test("remaining returns 0 when exhausted", () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.check("user1");
    limiter.check("user1");
    expect(limiter.remaining("user1")).toBe(0);
  });

  test("window resets after expiry", () => {
    const limiter = new RateLimiter(1, 10); // 10ms window
    limiter.check("user1");
    expect(limiter.check("user1")).toBe(false);

    // Wait for window to expire
    const start = Date.now();
    while (Date.now() - start < 15) {} // spin wait
    expect(limiter.check("user1")).toBe(true);
  });
});
