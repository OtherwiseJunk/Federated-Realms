import type { ServerIdentity } from "../atproto/server-identity.js";
import type { FederationConfig, AtProtoConfig } from "../types/server-config.js";
import { NSID } from "@realms/lexicons";

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
      const pdsEndpoint = await this.resolvePds(did);
      if (!pdsEndpoint) return null;

      // Try federation registration record first
      let server = await this.fetchRegistrationRecord(did, pdsEndpoint);

      // Fall back to world.server record
      if (!server) {
        server = await this.fetchServerRecord(did, pdsEndpoint);
      }

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

  private async resolvePds(did: string): Promise<string | null> {
    try {
      let didDoc: Record<string, unknown> | null = null;

      if (did.startsWith("did:plc:")) {
        const res = await fetch(`https://plc.directory/${did}`);
        if (!res.ok) return null;
        didDoc = (await res.json()) as Record<string, unknown>;
      } else if (did.startsWith("did:web:")) {
        const domain = did.replace("did:web:", "").replace(/:/g, "/");
        const res = await fetch(`https://${domain}/.well-known/did.json`);
        if (!res.ok) return null;
        didDoc = (await res.json()) as Record<string, unknown>;
      }

      if (!didDoc) return null;

      const service = (
        didDoc.service as Array<{ id: string; type: string; serviceEndpoint: string }>
      )?.find((s) => s.type === "AtprotoPersonalDataServer");
      return service?.serviceEndpoint ?? null;
    } catch (err) {
      console.warn(
        `   Failed to resolve PDS for ${did}:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  private async fetchRegistrationRecord(
    did: string,
    pdsEndpoint: string,
  ): Promise<KnownServer | null> {
    try {
      const url = `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${NSID.FederationRegistration}&rkey=self`;
      const res = await fetch(url);
      if (!res.ok) return null;

      const data = (await res.json()) as {
        value: {
          name?: string;
          description?: string;
          endpoint?: string;
          xrpcEndpoint?: string;
          levelRange?: { min?: number; max?: number };
          trustPolicy?: string;
          signingKey?: string;
        };
      };

      return {
        did,
        name: data.value.name ?? "Unknown",
        description: data.value.description,
        endpoint: data.value.endpoint ?? "",
        xrpcEndpoint: data.value.xrpcEndpoint,
        levelRange: data.value.levelRange,
        trustPolicy: data.value.trustPolicy,
        signingKey: data.value.signingKey,
        lastSeen: Date.now(),
      };
    } catch (err) {
      console.warn(
        `   Failed to fetch registration for ${did}:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  private async fetchServerRecord(did: string, pdsEndpoint: string): Promise<KnownServer | null> {
    try {
      const url = `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${NSID.WorldServer}&rkey=self`;
      const res = await fetch(url);
      if (!res.ok) return null;

      const data = (await res.json()) as {
        value: {
          name?: string;
          description?: string;
          endpoint?: string;
          xrpcEndpoint?: string;
        };
      };

      return {
        did,
        name: data.value.name ?? "Unknown",
        description: data.value.description,
        endpoint: data.value.endpoint ?? "",
        xrpcEndpoint: data.value.xrpcEndpoint,
        lastSeen: Date.now(),
      };
    } catch (err) {
      console.warn(
        `   Failed to fetch server record for ${did}:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }
}
