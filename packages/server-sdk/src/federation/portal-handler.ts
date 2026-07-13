import type { RoomExit } from "@realms/lexicons";
import { NSID } from "@realms/lexicons";
import type { CharacterSession } from "../entities/character-session.js";
import type { ServerIdentity } from "../atproto/server-identity.js";
import type { FederationManager } from "./federation-manager.js";
import { xrpcUrl } from "../atproto/xrpc.js";
import { encodeMessage } from "@realms/protocol";

/**
 * Handles portal traversal from the source server's perspective.
 * When a player enters a portal exit, this handler:
 * 1. Validates requirements (level, etc.)
 * 2. Resolves the target server's game endpoint via the FederationManager
 * 3. Creates a character snapshot + transfer JWT
 * 4. Calls the target server's transfer XRPC
 * 5. Sends a portal_offer to the client
 */
export class PortalHandler {
  constructor(
    private serverIdentity: ServerIdentity,
    private federation?: FederationManager,
  ) {}

  setFederationManager(federation: FederationManager): void {
    this.federation = federation;
  }

  /**
   * Parse a portal exit target string into server DID and room ID.
   * Format: "did:plc:abc123:room-id"
   */
  parsePortalTarget(target: string): { serverDid: string; roomId: string } | null {
    // Portal targets use format: did:plc:xxx:roomId or did:web:xxx:roomId
    const didMatch = target.match(
      /^(did:[a-z]+:[a-zA-Z0-9._:%-]+):([a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)*)$/,
    );
    if (!didMatch) return null;

    // The DID is everything up to the last colon-separated segment that looks like a room ID
    // e.g., "did:plc:abc123xyz:arrival-hall" -> did="did:plc:abc123xyz", room="arrival-hall"
    const parts = target.split(":");
    const roomId = parts.pop()!;
    const serverDid = parts.join(":");

    return { serverDid, roomId };
  }

  /**
   * Check if a room exit is a portal.
   */
  isPortalExit(exit: RoomExit): boolean {
    return exit.portal === true;
  }

  /**
   * Attempt portal traversal for a player.
   * Returns a narrative message to send to the player.
   */
  async traverse(
    session: CharacterSession,
    exit: RoomExit,
    sendNarrative: (text: string, style?: string) => void,
  ): Promise<boolean> {
    const parsed = this.parsePortalTarget(exit.target);
    if (!parsed) {
      sendNarrative("The portal flickers unstably. Its destination is malformed.", "error");
      return false;
    }

    const { serverDid, roomId } = parsed;

    // Check level requirement
    if (exit.requiredLevel && session.state.level < exit.requiredLevel) {
      sendNarrative(
        `The portal resists you. You must be at least level ${exit.requiredLevel} to pass through.`,
        "error",
      );
      return false;
    }

    // Resolve the target server's game endpoint. The FederationManager reads
    // it from the target's registration/world.server record (cached). A server
    // without a game xrpcEndpoint is unreachable — its PDS can't accept
    // transfers, so there is no fallback.
    const target = this.federation ? await this.federation.resolveServer(serverDid) : null;
    if (!target?.xrpcEndpoint) {
      sendNarrative("The portal flickers and dies. The destination realm is unreachable.", "error");
      return false;
    }

    sendNarrative("The portal shimmers and pulls you toward it...", "system");

    // Build character snapshot
    const snapshot = this.buildCharacterSnapshot(session);

    // Build attestations array from extensions
    const serverExt = session.state.extensions?.[this.serverIdentity.did] as
      | { attestations?: unknown[] }
      | undefined;
    const attestations = serverExt?.attestations ?? [];

    // Sign transfer JWT
    const characterHash = new Bun.CryptoHasher("sha256")
      .update(JSON.stringify(snapshot))
      .digest("hex");

    const now = Math.floor(Date.now() / 1000);
    const token = await this.serverIdentity.signTransferToken({
      iss: this.serverIdentity.did,
      sub: session.characterDid,
      aud: serverDid,
      iat: now,
      exp: now + 60,
      characterHash,
      targetRoom: roomId,
    });

    // Call target server's transfer endpoint
    try {
      const response = await fetch(xrpcUrl(target.xrpcEndpoint, NSID.FederationTransfer), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, character: snapshot, attestations }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        sendNarrative(
          "The portal rejects you. The destination realm refused the connection.",
          "error",
        );
        return false;
      }

      const result = (await response.json()) as {
        accepted: boolean;
        sessionId?: string;
        websocketUrl?: string;
        spawnRoom?: string;
        serverName?: string;
        reason?: string;
      };

      if (!result.accepted) {
        sendNarrative(`The portal rejects you: ${result.reason ?? "Unknown reason"}`, "error");
        return false;
      }

      // Send portal_offer to client
      session.send(
        encodeMessage({
          type: "portal_offer",
          targetServer: {
            name: result.serverName ?? target.name,
            did: serverDid,
            endpoint: result.websocketUrl ?? target.endpoint,
          },
          sessionId: result.sessionId ?? "",
          websocketUrl: result.websocketUrl ?? "",
        }),
      );

      return true;
    } catch {
      sendNarrative("The portal flickers and dies. The destination realm is unreachable.", "error");
      return false;
    }
  }

  private buildCharacterSnapshot(session: CharacterSession): Record<string, unknown> {
    const s = session.state;
    return {
      name: s.name,
      class: s.class,
      race: s.race,
      level: s.level,
      experience: s.experience,
      attributes: s.attributes,
      derived: { maxHp: s.maxHp, maxMp: s.maxMp, maxAp: s.maxAp },
      gold: s.gold,
      inventory: s.inventory,
      equipment: s.equipment,
      extensions: s.extensions,
      homeServer: this.serverIdentity.did,
    };
  }
}
