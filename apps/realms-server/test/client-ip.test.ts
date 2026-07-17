import { describe, expect, test } from "bun:test";
import { resolveClientIp } from "../src/client-ip.js";

describe("resolveClientIp", () => {
  test("with one trusted hop, takes the rightmost XFF entry (the proxy-added peer IP)", () => {
    // Client spoofs a prefix; the trusted proxy appends the real peer IP on the right.
    expect(resolveClientIp("1.1.1.1, 2.2.2.2, 9.9.9.9", 1, "127.0.0.1")).toBe("9.9.9.9");
  });

  test("ignores a client-spoofed X-Forwarded-For prefix", () => {
    // Attacker rotates the left value per request; the derived key stays stable.
    expect(resolveClientIp("evil-a, 9.9.9.9", 1, "127.0.0.1")).toBe("9.9.9.9");
    expect(resolveClientIp("evil-b, 9.9.9.9", 1, "127.0.0.1")).toBe("9.9.9.9");
  });

  test("with two trusted hops, takes the entry the outermost trusted proxy added", () => {
    expect(resolveClientIp("client, 8.8.8.8, 7.7.7.7", 2, "127.0.0.1")).toBe("8.8.8.8");
  });

  test("falls back to the socket address when XFF is missing", () => {
    expect(resolveClientIp(null, 1, "203.0.113.5")).toBe("203.0.113.5");
    expect(resolveClientIp(undefined, 1, "203.0.113.5")).toBe("203.0.113.5");
    expect(resolveClientIp("", 1, "203.0.113.5")).toBe("203.0.113.5");
  });

  test("falls back to the socket address when the chain is shorter than the hop count", () => {
    // Only one entry but two trusted proxies expected — don't trust it.
    expect(resolveClientIp("9.9.9.9", 2, "203.0.113.5")).toBe("203.0.113.5");
  });

  test("with zero trusted hops, ignores XFF entirely and uses the socket address", () => {
    expect(resolveClientIp("9.9.9.9", 0, "203.0.113.5")).toBe("203.0.113.5");
  });

  test("returns 'unknown' when neither a trusted XFF entry nor a socket address is available", () => {
    expect(resolveClientIp(null, 1, null)).toBe("unknown");
    expect(resolveClientIp("9.9.9.9", 2, undefined)).toBe("unknown");
  });

  test("trims whitespace around the selected entry", () => {
    expect(resolveClientIp("1.1.1.1,   9.9.9.9  ", 1, null)).toBe("9.9.9.9");
  });
});
