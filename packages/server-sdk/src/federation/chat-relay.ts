import type { ServerIdentity } from "../atproto/server-identity.js";
import type { FederationManager, KnownServer } from "./federation-manager.js";
import type { CharacterSession } from "../entities/character-session.js";
import { NSID } from "@realms/lexicons";
import { xrpcUrl } from "../atproto/xrpc.js";

interface RelayResult {
  delivered: boolean;
}

interface LocateResult {
  found: boolean;
  serverEndpoint: string;
}

/**
 * Handles cross-server tell messaging.
 *
 * Queries known servers to locate the target player, then relays the message
 * via XRPC to the server where they are online.
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
  ) {}

  /**
   * Relay a tell message to a player who may be on a remote server. Returns
   * `delivered: false` if the player can't be located online on any known
   * server.
   */
  async relayMessage(
    sender: CharacterSession,
    targetName: string,
    message: string,
  ): Promise<RelayResult> {
    // Query all known servers in parallel to locate the player
    const servers = [...this.federation.getKnownServers().values()].filter((s) => s.xrpcEndpoint);

    if (servers.length === 0) {
      return { delivered: false };
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
      return { delivered };
    }

    return { delivered: false };
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
    const data = (await res.json()) as { found: boolean };
    return {
      found: data.found,
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
}
