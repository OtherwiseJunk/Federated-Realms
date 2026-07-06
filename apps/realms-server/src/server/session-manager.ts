import type { CharacterProfile, FormulaDef } from "@realms/lexicons";
import { CharacterSession, type SessionData } from "../entities/character-session.js";
import type { ServerWebSocket } from "bun";
import type { ServerIdentity } from "../atproto/server-identity.js";

const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class SessionManager {
  private sessions = new Map<string, CharacterSession>();
  private didToSession = new Map<string, string>();
  private serverIdentity?: ServerIdentity;
  private lastActivity = new Map<string, number>();

  /** Set once during startup so all sessions get attestation tracking */
  setServerIdentity(identity: ServerIdentity): void {
    if (this.serverIdentity) {
      console.warn(
        "   ⚠  Server identity already set on SessionManager — this should only happen once during startup",
      );
      console.warn("   Ignoring duplicate setServerIdentity call");
      return;
    }
    this.serverIdentity = identity;
  }

  createSession(
    characterDid: string,
    profile: CharacterProfile,
    spawnRoom: string,
    formulas: Record<string, FormulaDef> = {},
  ): CharacterSession {
    // If player already has a session, remove it
    const existingSessionId = this.didToSession.get(characterDid);
    if (existingSessionId) {
      this.removeSession(existingSessionId);
    }

    const sessionId = crypto.randomUUID();
    const session = new CharacterSession(
      sessionId,
      characterDid,
      profile,
      spawnRoom,
      formulas,
      this.serverIdentity,
    );
    this.sessions.set(sessionId, session);
    this.didToSession.set(characterDid, sessionId);
    return session;
  }

  attachWebSocket(
    sessionId: string,
    ws: ServerWebSocket<SessionData>,
  ): CharacterSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.ws = ws;
    }
    return session;
  }

  getSession(sessionId: string): CharacterSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionByDid(did: string): CharacterSession | undefined {
    const sessionId = this.didToSession.get(did);
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  findByName(name: string): CharacterSession | undefined {
    const lower = name.toLowerCase();
    for (const session of this.sessions.values()) {
      if (session.name.toLowerCase() === lower) return session;
    }
    return undefined;
  }

  removeSession(sessionId: string): CharacterSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      this.didToSession.delete(session.characterDid);
      session.ws = null;
    }
    return session;
  }

  getAllSessions(): CharacterSession[] {
    return [...this.sessions.values()];
  }

  getOnlineCount(): number {
    return this.sessions.size;
  }

  /** Record activity for idle timeout tracking */
  touch(sessionId: string): void {
    this.lastActivity.set(sessionId, Date.now());
  }

  /** Get sessions that have been idle longer than the timeout */
  getIdleSessions(): CharacterSession[] {
    const cutoff = Date.now() - SESSION_IDLE_TIMEOUT_MS;
    const idle: CharacterSession[] = [];
    for (const [sessionId, session] of this.sessions) {
      const lastActive = this.lastActivity.get(sessionId) ?? 0;
      if (lastActive < cutoff) {
        idle.push(session);
      }
    }
    return idle;
  }
}
