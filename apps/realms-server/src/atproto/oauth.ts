import { NodeOAuthClient } from "@atproto/oauth-client-node";
import { Agent } from "@atproto/api";
import type { AtProtoConfig } from "../config.js";

interface StoreEntry<V> {
  value: V;
  expiresAt?: number;
}

/**
 * Simple in-memory store that implements the SimpleStore interface
 * required by @atproto/oauth-client-node.
 */
class MemoryStore<V> {
  private data = new Map<string, StoreEntry<V>>();

  async get(key: string): Promise<V | undefined> {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.data.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: V): Promise<void> {
    this.data.set(key, { value });
  }

  async del(key: string): Promise<void> {
    this.data.delete(key);
  }
}

/**
 * Manages OAuth authentication for player connections.
 * Wraps @atproto/oauth-client-node to handle:
 * - Starting auth flows (returns URL to redirect to)
 * - Handling callbacks (exchanges code for session)
 * - Restoring sessions for returning players
 * - Getting authenticated agents for PDS access
 */
export class GameOAuthClient {
  private client: NodeOAuthClient | null = null;
  private config: AtProtoConfig | null = null;

  get initialized(): boolean {
    return this.client !== null;
  }

  async initialize(config: AtProtoConfig): Promise<void> {
    this.config = config;

    this.client = new NodeOAuthClient({
      clientMetadata: {
        client_id: `${config.publicUrl}/oauth/client-metadata.json`,
        client_name: "Federated Realms",
        client_uri: config.publicUrl,
        redirect_uris: [`${config.publicUrl}/oauth/callback`, "http://127.0.0.1/oauth/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "atproto transition:generic",
        dpop_bound_access_tokens: true,
        token_endpoint_auth_method: "none",
        application_type: "web",
      },
      stateStore: new MemoryStore(),
      sessionStore: new MemoryStore(),
    });

    console.log("   OAuth client initialized");
  }

  /**
   * Start OAuth flow for a player handle.
   * Returns the authorization URL to redirect the user to.
   */
  async authorize(handle: string): Promise<URL> {
    if (!this.client) throw new Error("OAuth not initialized");
    return this.client.authorize(handle, {
      scope: "atproto transition:generic",
    });
  }

  /**
   * Handle OAuth callback after user approves.
   * Returns the authenticated session.
   */
  async callback(params: URLSearchParams): Promise<{
    session: { did: string };
    agent: Agent;
  }> {
    if (!this.client) throw new Error("OAuth not initialized");
    const { session } = await this.client.callback(params);
    const agent = new Agent(session);
    return {
      session: { did: session.sub },
      agent,
    };
  }

  /**
   * Restore an existing session for a returning player.
   * Returns null if no session exists or it can't be refreshed.
   */
  async restore(did: string): Promise<Agent | null> {
    if (!this.client) return null;
    try {
      const session = await this.client.restore(did);
      return new Agent(session);
    } catch {
      return null;
    }
  }

  /**
   * Revoke a player's session.
   */
  async revoke(did: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.revoke(did);
    } catch {
      // Session may not exist
    }
  }

  /**
   * Returns the OAuth client metadata JSON for serving at
   * /oauth/client-metadata.json
   */
  getClientMetadata(publicUrlOverride?: string): Record<string, unknown> {
    const publicUrl = this.config?.publicUrl ?? publicUrlOverride ?? "http://localhost:3000";
    return {
      client_id: `${publicUrl}/oauth/client-metadata.json`,
      client_name: "Federated Realms",
      client_uri: publicUrl,
      redirect_uris: [`${publicUrl}/oauth/callback`, "http://127.0.0.1/oauth/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "atproto transition:generic",
      dpop_bound_access_tokens: true,
      token_endpoint_auth_method: "none",
      application_type: "web",
    };
  }
}
