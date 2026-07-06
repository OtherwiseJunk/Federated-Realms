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
  bluesky: BlueskyConfig;
  atproto: AtProtoConfig;
  federation: FederationConfig;
}

export function loadConfig(): ServerConfig {
  return {
    name: process.env.SERVER_NAME ?? "Federated Realms",
    description: process.env.SERVER_DESCRIPTION ?? "A mysterious dungeon awaits...",
    port: parseInt(process.env.PORT ?? "3000", 10),
    host: process.env.HOST ?? "0.0.0.0",
    tickRate: parseInt(process.env.TICK_RATE ?? "250", 10),
    defaultSpawnRoom: process.env.DEFAULT_SPAWN ?? "starter-town:town-square",
    dataPath:
      process.env.DATA_PATH ?? decodeURIComponent(new URL("../data", import.meta.url).pathname),
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
    },
    federation: {
      trustPolicy: parseTrustPolicy(process.env.TRUST_POLICY ?? "trust-listed"),
      trustedServers: parseTrustedServers(process.env.TRUSTED_SERVERS ?? ""),
      maxAcceptedLevel: parseInt(process.env.MAX_ACCEPTED_LEVEL ?? "50", 10),
    },
  };
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
