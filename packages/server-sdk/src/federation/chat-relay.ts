import type { ServerIdentity } from "../atproto/server-identity.js";
import type { FederationManager, KnownServer } from "./federation-manager.js";
import type { SessionManager } from "../server/session-manager.js";
import type { CharacterSession } from "../entities/character-session.js";
import { NSID } from "@realms/lexicons";
import { encodeMessage } from "@realms/protocol";
import { xrpcUrl } from "../atproto/xrpc.js";

interface RelayResult {
  delivered: boolean;
  offline: boolean;
  notFound: boolean;
}

interface LocateResult {
  found: boolean;
  playerDid?: string;
  serverEndpoint: string;
}

/**
 * Handles cross-server tell messaging and offline mailbox.
 *
 * - Real-time: queries known servers to locate the target, relays via XRPC.
 * - Offline: stores a chat.message record in the server's PDS for later delivery.
 */
export class ChatRelayService {
  /** Rate limit: max N tells per window per session */
  private rateLimits = new Map<string, number[]>();
  private lastPrune = 0;
  private static RATE_MAX = 5;
  private static RATE_WINDOW = 10_000; // 10 seconds

  constructor(
    private serverIdentity: ServerIdentity,
    private federation: FederationManager,
    private sessions: SessionManager,
  ) {}

  /**
   * Relay a tell message to a player who may be on a remote server.
   * If the player is offline everywhere, stores it for later delivery.
   */
  async relayMessage(
    sender: CharacterSession,
    targetName: string,
    message: string,
  ): Promise<RelayResult> {
    // Query all known servers in parallel to locate the player
    const servers = [...this.federation.getKnownServers().values()].filter((s) => s.xrpcEndpoint);

    if (servers.length === 0) {
      return { delivered: false, offline: false, notFound: true };
    }

    const results = await Promise.allSettled(servers.map((s) => this.locatePlayer(s, targetName)));

    const found = results.find(
      (r): r is PromiseFulfilledResult<LocateResult> => r.status === "fulfilled" && r.value.found,
    );

    if (found) {
      // Relay to the server where the player is online
      const delivered = await this.sendRelay(
        found.value.serverEndpoint,
        sender,
        targetName,
        message,
      );
      return { delivered, offline: false, notFound: !delivered };
    }

    // Player not found online — try to store offline message
    const recipientDid = await this.resolvePlayerDid(targetName, servers, results);
    if (recipientDid) {
      await this.storeOfflineMessage(sender, recipientDid, targetName, message);
      return { delivered: false, offline: true, notFound: false };
    }

    return { delivered: false, offline: false, notFound: true };
  }

  /**
   * Deliver any pending offline messages to a player who just logged in.
   */
  async deliverPendingMessages(session: CharacterSession): Promise<void> {
    try {
      const resp = await this.serverIdentity.agent.com.atproto.repo.listRecords({
        repo: this.serverIdentity.did,
        collection: NSID.ChatMessage,
        limit: 100,
      });

      const pending = resp.data.records.filter(
        (r) => (r.value as Record<string, unknown>).recipientDid === session.characterDid,
      );

      if (pending.length === 0) return;

      const messages = pending.map((r) => {
        const v = r.value as Record<string, string>;
        return {
          senderName: v.senderName,
          senderDid: v.senderDid,
          message: v.message,
          sourceServer: v.sourceServer,
          sentAt: v.createdAt,
        };
      });

      session.send(encodeMessage({ type: "mailbox", messages }));

      // Delete delivered records
      for (const record of pending) {
        try {
          const rkey = record.uri.split("/").pop()!;
          await this.serverIdentity.agent.com.atproto.repo.deleteRecord({
            repo: this.serverIdentity.did,
            collection: NSID.ChatMessage,
            rkey,
          });
        } catch {
          // Best-effort cleanup
        }
      }
    } catch (err) {
      console.warn("   Failed to deliver mailbox:", err instanceof Error ? err.message : err);
    }
  }

  /**
   * Check rate limit for tell commands. Returns true if rate-limited.
   */
  isRateLimited(sessionId: string): boolean {
    const now = Date.now();
    this.pruneStale(now);
    const timestamps = this.rateLimits.get(sessionId) ?? [];
    const recent = timestamps.filter((t) => now - t < ChatRelayService.RATE_WINDOW);
    if (recent.length >= ChatRelayService.RATE_MAX) return true;
    recent.push(now);
    this.rateLimits.set(sessionId, recent);
    return false;
  }

  /** Drop sessions whose newest tell is outside the window; at most once per window */
  private pruneStale(now: number): void {
    if (now - this.lastPrune < ChatRelayService.RATE_WINDOW) return;
    this.lastPrune = now;
    for (const [sessionId, timestamps] of this.rateLimits) {
      const newest = timestamps[timestamps.length - 1] ?? 0;
      if (now - newest >= ChatRelayService.RATE_WINDOW) {
        this.rateLimits.delete(sessionId);
      }
    }
  }

  private async locatePlayer(server: KnownServer, name: string): Promise<LocateResult> {
    const url = xrpcUrl(server.xrpcEndpoint!, NSID.ChatLocatePlayer, { name });
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { found: false, serverEndpoint: server.xrpcEndpoint! };
    const data = (await res.json()) as {
      found: boolean;
      playerDid?: string;
    };
    return {
      found: data.found,
      playerDid: data.playerDid,
      serverEndpoint: server.xrpcEndpoint!,
    };
  }

  private async sendRelay(
    xrpcEndpoint: string,
    sender: CharacterSession,
    targetName: string,
    message: string,
  ): Promise<boolean> {
    try {
      const res = await fetch(xrpcUrl(xrpcEndpoint, NSID.ChatRelay), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderName: sender.name,
          senderDid: sender.characterDid,
          recipientName: targetName,
          message,
          sourceServer: this.serverIdentity.did,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { delivered: boolean };
      return data.delivered;
    } catch {
      return false;
    }
  }

  private async storeOfflineMessage(
    sender: CharacterSession,
    recipientDid: string,
    _recipientName: string,
    message: string,
  ): Promise<void> {
    try {
      const rkey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      await this.serverIdentity.agent.com.atproto.repo.putRecord({
        repo: this.serverIdentity.did,
        collection: NSID.ChatMessage,
        rkey,
        record: {
          $type: NSID.ChatMessage,
          senderDid: sender.characterDid,
          senderName: sender.name,
          recipientDid,
          message,
          sourceServer: this.serverIdentity.did,
          createdAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.warn("   Failed to store offline message:", err instanceof Error ? err.message : err);
    }
  }

  /**
   * Try to resolve a player's DID by name. Checks local session history
   * first, then queries known servers.
   */
  private async resolvePlayerDid(
    name: string,
    servers: KnownServer[],
    locateResults: PromiseSettledResult<LocateResult>[],
  ): Promise<string | null> {
    // Check local sessions (current or past — findByName only finds current)
    const local = this.sessions.findByName(name);
    if (local) return local.characterDid;

    // Check if any locate response returned a DID even though player isn't online
    for (const r of locateResults) {
      if (r.status === "fulfilled" && r.value.playerDid) {
        return r.value.playerDid;
      }
    }

    return null;
  }
}
