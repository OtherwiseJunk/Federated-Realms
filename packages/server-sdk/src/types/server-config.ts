export type BlueskyPostType =
  | "chat"
  | "shout"
  | "emote"
  | "event"
  | "narrative"
  | "movement"
  | "combat"
  | "system";

export interface BlueskyConfig {
  enabled: boolean;
  identifier: string;
  password: string;
  service: string;
  postTypes: BlueskyPostType[];
  playerCrossPost: boolean;
  roomThreadRefreshMinutes: number;
  throttleMs: number;
}

export interface AtProtoConfig {
  pdsUrl: string;
  pdsHostname: string;
  serverDid: string;
  serverHandle: string;
  serverPassword: string;
  publicUrl: string;
  /** Publicly reachable PDS URL — used as OAuth input for the signup flow. */
  pdsPublicUrl: string;
}

export interface FederationConfig {
  trustPolicy: "trust-all" | "trust-listed" | "trust-none" | "trust-level-cap";
  trustedServers: string[];
  maxAcceptedLevel: number;
}

export interface ServerConfig {
  name: string;
  description: string;
  port: number;
  host: string;
  tickRate: number;
  defaultSpawnRoom: string;
  dataPath: string;
  /** Directory for mutable server state (SQLite DB). Distinct from dataPath (world data). */
  dataDir: string;
  /**
   * Number of trusted reverse proxies in front of this server. Used to derive
   * the real client IP from `X-Forwarded-For` (counting hops from the right)
   * for rate-limit keys, resisting header spoofing. Defaults to 1 (single host
   * nginx). 0 disables trusting the header entirely.
   */
  trustedProxyHops: number;
  bluesky: BlueskyConfig;
  atproto: AtProtoConfig;
  federation: FederationConfig;
}

export function loadConfig(defaultDataPath?: string): ServerConfig {
  return {
    name: process.env.SERVER_NAME ?? "Federated Realms",
    description: process.env.SERVER_DESCRIPTION ?? "A mysterious dungeon awaits...",
    port: parseInt(process.env.PORT ?? "3000", 10),
    host: process.env.HOST ?? "0.0.0.0",
    tickRate: parseInt(process.env.TICK_RATE ?? "250", 10),
    defaultSpawnRoom: process.env.DEFAULT_SPAWN ?? "starter-town:town-square",
    dataPath: process.env.DATA_PATH ?? defaultDataPath ?? "./data",
    dataDir: process.env.DATA_DIR ?? "./.state",
    trustedProxyHops: parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS),
    bluesky: {
      enabled: process.env.BSKY_ENABLED === "true",
      identifier: process.env.BSKY_IDENTIFIER ?? "",
      password: process.env.BSKY_PASSWORD ?? "",
      service: process.env.BSKY_SERVICE ?? "https://bsky.social",
      postTypes: parsePostTypes(process.env.BSKY_POST_TYPES ?? "chat,shout,event"),
      playerCrossPost: process.env.BSKY_PLAYER_CROSSPOST !== "false",
      roomThreadRefreshMinutes: parseInt(process.env.BSKY_THREAD_REFRESH ?? "60", 10),
      throttleMs: parseInt(process.env.BSKY_THROTTLE_MS ?? "2000", 10),
    },
    atproto: {
      pdsUrl: process.env.PDS_URL ?? "http://localhost:2583",
      pdsHostname: process.env.PDS_HOSTNAME ?? "localhost",
      serverDid: process.env.SERVER_DID ?? "",
      serverHandle:
        process.env.SERVER_HANDLE ?? `server.${process.env.PDS_HOSTNAME ?? "localhost"}`,
      serverPassword: process.env.SERVER_PASSWORD ?? "",
      publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? "3000"}`,
      pdsPublicUrl:
        process.env.PDS_PUBLIC_URL ??
        ((process.env.PDS_HOSTNAME ?? "localhost") !== "localhost"
          ? `https://${process.env.PDS_HOSTNAME}`
          : (process.env.PDS_URL ?? "http://localhost:2583")),
    },
    federation: {
      trustPolicy: parseTrustPolicy(process.env.TRUST_POLICY ?? "trust-listed"),
      trustedServers: parseTrustedServers(process.env.TRUSTED_SERVERS ?? ""),
      maxAcceptedLevel: parseInt(process.env.MAX_ACCEPTED_LEVEL ?? "50", 10),
    },
  };
}

/**
 * Parse TRUSTED_PROXY_HOPS. Defaults to 1 (single host nginx). Non-numeric or
 * negative values fall back to the safe default of 1; 0 is honored (disables
 * trusting X-Forwarded-For).
 *
 * SECURITY: this is only sound if the app sits behind exactly this many trusted
 * reverse proxies AND is not reachable directly. A client that can reach the app
 * without traversing those proxies can forge X-Forwarded-For and spoof its
 * rate-limit identity, defeating the limiter. Set to 0 (use the socket address,
 * ignore X-Forwarded-For) if the app is directly exposed.
 */
function parseTrustedProxyHops(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 1;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) return 1;
  return n;
}

function parsePostTypes(str: string): BlueskyPostType[] {
  return str
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as BlueskyPostType[];
}

type TrustPolicy = "trust-all" | "trust-listed" | "trust-none" | "trust-level-cap";

function parseTrustPolicy(str: string): TrustPolicy {
  const valid: TrustPolicy[] = ["trust-all", "trust-listed", "trust-none", "trust-level-cap"];
  return valid.includes(str as TrustPolicy) ? (str as TrustPolicy) : "trust-listed";
}

function parseTrustedServers(str: string): string[] {
  return str
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
