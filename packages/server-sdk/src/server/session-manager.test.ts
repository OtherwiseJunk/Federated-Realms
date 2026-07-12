import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { SessionManager } from "./session-manager.js";
import type { CharacterProfile } from "@realms/lexicons";

function makeProfile(overrides: Partial<CharacterProfile> = {}): CharacterProfile {
  return {
    name: "TestHero",
    class: "warrior",
    race: "human",
    level: 1,
    experience: 0,
    attributes: { str: 14, dex: 12, con: 13, int: 10, wis: 10, cha: 12 },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const MINUTE = 60_000;

afterEach(() => {
  setSystemTime();
});

describe("SessionManager idle tracking", () => {
  test("brand-new session is not idle", () => {
    const manager = new SessionManager();
    manager.createSession("did:plc:test", makeProfile(), "test-area:spawn");

    expect(manager.getIdleSessions()).toHaveLength(0);
  });

  test("session with no activity for over 30 minutes is idle", () => {
    const manager = new SessionManager();
    const start = Date.now();
    setSystemTime(new Date(start));
    manager.createSession("did:plc:test", makeProfile(), "test-area:spawn");

    setSystemTime(new Date(start + 31 * MINUTE));
    expect(manager.getIdleSessions()).toHaveLength(1);
  });

  test("touch resets the idle clock", () => {
    const manager = new SessionManager();
    const start = Date.now();
    setSystemTime(new Date(start));
    const session = manager.createSession("did:plc:test", makeProfile(), "test-area:spawn");

    setSystemTime(new Date(start + 29 * MINUTE));
    manager.touch(session.sessionId);

    setSystemTime(new Date(start + 31 * MINUTE));
    expect(manager.getIdleSessions()).toHaveLength(0);
  });

  test("attaching a WebSocket counts as activity", () => {
    const manager = new SessionManager();
    const start = Date.now();
    setSystemTime(new Date(start));
    const session = manager.createSession("did:plc:test", makeProfile(), "test-area:spawn");

    setSystemTime(new Date(start + 29 * MINUTE));
    manager.attachWebSocket(session.sessionId, {} as never);

    setSystemTime(new Date(start + 31 * MINUTE));
    expect(manager.getIdleSessions()).toHaveLength(0);
  });
});
