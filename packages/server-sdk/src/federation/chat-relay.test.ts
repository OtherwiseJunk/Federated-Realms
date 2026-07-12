import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { ChatRelayService } from "./chat-relay.js";

function makeRelay(): ChatRelayService {
  return new ChatRelayService({} as never, {} as never, {} as never);
}

function limitsOf(relay: ChatRelayService): Map<string, number[]> {
  return (relay as unknown as { rateLimits: Map<string, number[]> }).rateLimits;
}

afterEach(() => {
  setSystemTime();
});

describe("ChatRelayService rate limiting", () => {
  test("allows up to 5 tells in a window, blocks the 6th", () => {
    const relay = makeRelay();
    for (let i = 0; i < 5; i++) {
      expect(relay.isRateLimited("session-1")).toBe(false);
    }
    expect(relay.isRateLimited("session-1")).toBe(true);
  });

  test("allows again after the window passes", () => {
    const relay = makeRelay();
    const start = Date.now();
    setSystemTime(new Date(start));
    for (let i = 0; i < 5; i++) relay.isRateLimited("session-1");
    expect(relay.isRateLimited("session-1")).toBe(true);

    setSystemTime(new Date(start + 11_000));
    expect(relay.isRateLimited("session-1")).toBe(false);
  });

  test("prunes stale sessions from the rate-limit map", () => {
    const relay = makeRelay();
    const start = Date.now();
    setSystemTime(new Date(start));
    relay.isRateLimited("stale-session");

    setSystemTime(new Date(start + 60_000));
    relay.isRateLimited("active-session");

    expect(limitsOf(relay).has("stale-session")).toBe(false);
    expect(limitsOf(relay).has("active-session")).toBe(true);
  });
});
