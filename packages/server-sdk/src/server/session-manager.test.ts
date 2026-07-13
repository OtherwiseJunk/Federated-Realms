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

  test("removeSession invokes onRemove and closes the socket", () => {
    const manager = new SessionManager();
    const events: string[] = [];
    manager.onRemove = (session) => events.push(`removed:${session.sessionId}`);
    const session = manager.createSession("did:plc:test", makeProfile(), "test-area:spawn");
    const ws = { close: () => events.push("ws-closed") };
    manager.attachWebSocket(session.sessionId, ws as never);

    manager.removeSession(session.sessionId);

    expect(events).toEqual([`removed:${session.sessionId}`, "ws-closed"]);
  });

  test("onRemove fires at most once per session", () => {
    const manager = new SessionManager();
    let calls = 0;
    manager.onRemove = () => calls++;
    const session = manager.createSession("did:plc:test", makeProfile(), "test-area:spawn");

    manager.removeSession(session.sessionId);
    manager.removeSession(session.sessionId);

    expect(calls).toBe(1);
  });

  test("duplicate login removes the old session through onRemove", () => {
    const manager = new SessionManager();
    const removed: string[] = [];
    manager.onRemove = (session) => removed.push(session.sessionId);
    const first = manager.createSession("did:plc:test", makeProfile(), "test-area:spawn");
    let oldSocketClosed = false;
    manager.attachWebSocket(first.sessionId, { close: () => (oldSocketClosed = true) } as never);

    const second = manager.createSession("did:plc:test", makeProfile(), "test-area:spawn");

    expect(removed).toEqual([first.sessionId]);
    expect(oldSocketClosed).toBe(true);
    expect(manager.getSession(second.sessionId)).toBeDefined();
    expect(manager.getSessionByDid("did:plc:test")?.sessionId).toBe(second.sessionId);
  });

  test("removeSession clears activity tracking", () => {
    const manager = new SessionManager();
    const session = manager.createSession("did:plc:test", makeProfile(), "test-area:spawn");
    manager.removeSession(session.sessionId);

    const tracking = (manager as unknown as { lastActivity: Map<string, number> }).lastActivity;
    expect(tracking.has(session.sessionId)).toBe(false);
  });
});
