import type { ServerIdentity } from "../atproto/server-identity.js";
import type { FederationConfig, AtProtoConfig } from "../types/server-config.js";
import { NSID } from "@realms/lexicons";
import { fetchRecord, normalizeXrpcEndpoint, resolvePdsEndpoint } from "../atproto/xrpc.js";

/**
 * Shape shared by federation.registration and world.server record values —
 * registration is a superset of the fields we read from world.server.
 */
interface ServerRecordValue {
  name?: string;
  description?: string;
  endpoint?: string;
  xrpcEndpoint?: string;
  levelRange?: { min?: number; max?: number };
  trustPolicy?: string;
  signingKey?: string;
}

export interface KnownServer {
  did: string;
  name: string;
  description?: string;
  endpoint: string;
  xrpcEndpoint?: string;
  levelRange?: { min?: number; max?: number };
  trustPolicy?: string;
  /** Base64url-encoded secp256k1 public key for verifying attestations and transfer JWTs */
  signingKey?: string;
  lastSeen: number; // Date.now()
}

/**
 * Tracks known servers in the federation network.
 * Publishes this server's registration record and can
 * resolve remote server metadata from their PDS.
 */
export class FederationManager {
  private knownServers = new Map<string, KnownServer>();
  private lastPortalCount = 0;

  constructor(
    private serverIdentity: ServerIdentity,
    private federationConfig: FederationConfig,
    private atprotoConfig: AtProtoConfig,
    private serverName: string,
    private serverDescription: string,
  ) {}

  /**
   * Publish this server's federation registration record to its PDS.
   * Called once at startup after AT Proto initialization.
   */
  async publishRegistration(portalCount: number, playerCount: number): Promise<void> {
    this.lastPortalCount = portalCount;
    try {
      await this.serverIdentity.agent.com.atproto.repo.putRecord({
        repo: this.serverIdentity.did,
        collection: NSID.FederationRegistration,
        rkey: "self",
        record: {
          $type: NSID.FederationRegistration,
          serverDid: this.serverIdentity.did,
          name: this.serverName,
          description: this.serverDescription,
          endpoint: `${this.atprotoConfig.publicUrl}/ws`,
          xrpcEndpoint: `${this.atprotoConfig.publicUrl}/xrpc`,
          trustPolicy: this.federationConfig.trustPolicy,
          signingKey: Buffer.from(this.serverIdentity.getPublicKeyBytes()).toString("base64url"),
          portalCount,
          playerCount,
          createdAt: new Date().toISOString(),
        },
      });
      console.log("   Published federation registration to PDS");
    } catch (err) {
      console.warn(
        "   Failed to publish federation registration:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  /**
   * Update the player count in the registration record.
   * Called periodically to keep discovery data fresh.
   */
  async updatePlayerCount(count: number): Promise<void> {
    try {
      await this.serverIdentity.agent.com.atproto.repo.putRecord({
        repo: this.serverIdentity.did,
        collection: NSID.FederationRegistration,
        rkey: "self",
        record: {
          $type: NSID.FederationRegistration,
          serverDid: this.serverIdentity.did,
          name: this.serverName,
          description: this.serverDescription,
          endpoint: `${this.atprotoConfig.publicUrl}/ws`,
          xrpcEndpoint: `${this.atprotoConfig.publicUrl}/xrpc`,
          trustPolicy: this.federationConfig.trustPolicy,
          signingKey: Buffer.from(this.serverIdentity.getPublicKeyBytes()).toString("base64url"),
          portalCount: this.lastPortalCount,
          playerCount: count,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.warn("   Failed to update player count:", err instanceof Error ? err.message : err);
    }
  }

  /**
   * Resolve a remote server's metadata by reading its registration record
   * from its PDS (discovered via DID resolution).
   */
  async resolveServer(did: string): Promise<KnownServer | null> {
    // Check cache first (valid for 5 minutes)
    const cached = this.knownServers.get(did);
    if (cached && Date.now() - cached.lastSeen < 5 * 60 * 1000) {
      return cached;
    }

    try {
      const pdsEndpoint = await resolvePdsEndpoint(did);
      if (!pdsEndpoint) return null;

      // Try federation registration record first, fall back to world.server
      const server =
        (await this.fetchKnownServer(did, pdsEndpoint, NSID.FederationRegistration)) ??
        (await this.fetchKnownServer(did, pdsEndpoint, NSID.WorldServer));

      if (server) {
        this.knownServers.set(did, server);
      }
      return server;
    } catch (err) {
      console.warn(`   Failed to resolve server ${did}:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * Add a server as known (e.g., from config or portal definitions).
   */
  addKnownServer(server: KnownServer): void {
    this.knownServers.set(server.did, server);
  }

  /**
   * Get all known servers.
   */
  getKnownServers(): Map<string, KnownServer> {
    return this.knownServers;
  }

  /**
   * Seed the known servers list from trusted servers config.
   * Resolves each configured DID in parallel.
   */
  async seedFromConfig(): Promise<void> {
    const promises = this.federationConfig.trustedServers
      .filter((did) => did.startsWith("did:"))
      .map((did) => this.resolveServer(did));

    const results = await Promise.allSettled(promises);
    const resolved = results.filter(
      (r): r is PromiseFulfilledResult<KnownServer | null> =>
        r.status === "fulfilled" && r.value !== null,
    );

    if (resolved.length > 0) {
      console.log(`   Discovered ${resolved.length} federated server(s)`);
    }
  }

  /**
   * Fetch a server metadata record from the given PDS and map it onto a
   * KnownServer. The record's xrpcEndpoint is normalized at this read
   * boundary so the rest of the SDK always sees the /xrpc-prefixed form.
   */
  private async fetchKnownServer(
    did: string,
    pdsEndpoint: string,
    collection: string,
  ): Promise<KnownServer | null> {
    const value = await fetchRecord<ServerRecordValue>(pdsEndpoint, did, collection, "self");
    if (!value) return null;

    return {
      did,
      name: value.name ?? "Unknown",
      description: value.description,
      endpoint: value.endpoint ?? "",
      xrpcEndpoint: value.xrpcEndpoint ? normalizeXrpcEndpoint(value.xrpcEndpoint) : undefined,
      levelRange: value.levelRange,
      trustPolicy: value.trustPolicy,
      signingKey: value.signingKey,
      lastSeen: Date.now(),
    };
  }
}
