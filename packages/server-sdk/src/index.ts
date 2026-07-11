// ─── @realms/server-sdk ───
// SDK for building Federated Realms servers.
// Provides AT Proto integration, federation protocol, world management,
// combat, quests, crafting, and extensible command handling.

// ── Types & Interfaces ──
export type {
  ServerConfig,
  AtProtoConfig,
  FederationConfig,
  BlueskyConfig,
  BlueskyPostType,
} from "./types/server-config.js";
export { loadConfig } from "./types/server-config.js";

export type { ServerHooks } from "./types/hooks.js";

export type { CommandContext, CommandHandler, CommandRegistry } from "./types/command.js";

// ── AT Proto ──
export {
  ServerIdentity,
  type TransferPayload,
  type AttestationClaims,
  type SignedAttestation,
} from "./atproto/server-identity.js";

export { PdsClient } from "./atproto/pds-client.js";

export { AttestationTracker } from "./atproto/attestation-tracker.js";

export { GameOAuthClient } from "./atproto/oauth.js";

export { SqliteSimpleStore, type OAuthStoreTable } from "./atproto/sqlite-stores.js";

export { AuthTokenStore } from "./atproto/auth-token-store.js";

export { WorldPublisher } from "./atproto/world-publisher.js";

// ── World Management ──
export { Room } from "./world/room.js";
export { loadGameSystem } from "./world/system-loader.js";
export { AreaManager } from "./world/area-manager.js";
export { WorldManager } from "./world/world-manager.js";

// ── Entities ──
export { CharacterSession, type SessionData } from "./entities/character-session.js";

export { NpcManager, type LootEntry, type GoldDrop } from "./entities/npc-manager.js";

// ── Systems ──
export { CombatSystem, type CombatContext } from "./systems/combat-system.js";

export { QuestManager, type ActiveQuestState } from "./systems/quest-manager.js";

export {
  CraftingSystem,
  type GatherYield,
  type GatheringNode,
  type CraftResult,
  type GatherResult,
} from "./systems/crafting-system.js";

// ── Federation ──
export { FederationManager, type KnownServer } from "./federation/federation-manager.js";

export { PortalHandler } from "./federation/portal-handler.js";

export {
  TransferHandler,
  type TransferInput,
  type TransferOutput,
  type PendingAdaptation,
} from "./federation/transfer-handler.js";

export { ChatRelayService } from "./federation/chat-relay.js";

// ── Server Infrastructure ──
export { SessionManager } from "./server/session-manager.js";
export { RateLimiter } from "./server/rate-limiter.js";
export { openStateDatabase } from "./server/state-db.js";

// ── Integrations ──
export { BlueskyBridge, type GameEvent } from "./integrations/bluesky-bridge.js";
