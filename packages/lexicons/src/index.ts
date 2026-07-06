// Core lexicon types for Federated Realms, generated from AT Proto lexicon schemas.
//
// Generated types live in ./lexicons/ (run `bun run generate` to refresh).
// This file re-exports them with backward-compatible names and typed open maps.

// ── Open map type aliases ──
// Lexicon uses `unknown` for open maps; we layer stronger types here.

/** Open map of attribute ID -> numeric value, e.g. { str: 14, dex: 12 } */
export type Attributes = Record<string, number>;

/** Cached derived stats computed from server formulas */
export type DerivedStats = Record<string, number>;

/** Server-specific extension data, keyed by server DID */
export type Extensions = Record<string, unknown>;

/** Open map of property ID -> value for items */
export type ItemProperties = Record<string, unknown>;

// ── Imports from generated types ──

import type { Main as _CharacterProfile } from "./lexicons/com/cacheblasters/realms/character/profile.defs.js";
import type { Main as _AttributeDef } from "./lexicons/com/cacheblasters/realms/system/attribute.defs.js";
import type { Main as _ClassDef } from "./lexicons/com/cacheblasters/realms/system/class.defs.js";
import type { Main as _SpellDef } from "./lexicons/com/cacheblasters/realms/system/spell.defs.js";
import type { Main as _RaceDef } from "./lexicons/com/cacheblasters/realms/system/race.defs.js";
import type { Main as _EquipSlotDef } from "./lexicons/com/cacheblasters/realms/system/equipSlot.defs.js";
import type {
  Main as _ItemTypeDef,
  PropertyDef as _PropertyDef,
} from "./lexicons/com/cacheblasters/realms/system/itemType.defs.js";
import type { Main as _FormulaDef } from "./lexicons/com/cacheblasters/realms/system/formula.defs.js";
import type {
  Main as _RoomRecord,
  Exit as _RoomExit,
  Coordinates as _Coordinates,
} from "./lexicons/com/cacheblasters/realms/world/room.defs.js";
import type {
  Main as _AreaRecord,
  LevelRange,
} from "./lexicons/com/cacheblasters/realms/world/area.defs.js";
import type { Main as _ServerRecord } from "./lexicons/com/cacheblasters/realms/world/server.defs.js";
import type {
  Main as _FlagRecord,
  FlagEffect as _FlagEffect,
} from "./lexicons/com/cacheblasters/realms/world/flag.defs.js";
import type { Main as _ItemDefinition } from "./lexicons/com/cacheblasters/realms/item/definition.defs.js";
import type { Main as _NpcDefinition } from "./lexicons/com/cacheblasters/realms/npc/definition.defs.js";
import type {
  Main as _QuestDefinition,
  Objective as _QuestObjective,
  Rewards as _QuestRewards,
} from "./lexicons/com/cacheblasters/realms/quest/definition.defs.js";
import type {
  Main as _QuestProgress,
  ObjectiveProgress as _QuestObjectiveProgress,
} from "./lexicons/com/cacheblasters/realms/quest/progress.defs.js";
import type {
  Main as _RecipeDef,
  Ingredient as _RecipeIngredient,
  Output as _RecipeOutput,
} from "./lexicons/com/cacheblasters/realms/craft/recipe.defs.js";
import type {
  Main as _FederationRegistration,
  LevelRange as _FedLevelRange,
} from "./lexicons/com/cacheblasters/realms/federation/registration.defs.js";
import type { Main as _PortalRecord } from "./lexicons/com/cacheblasters/realms/world/portal.defs.js";
import type { Main as _ChatMessage } from "./lexicons/com/cacheblasters/realms/chat/message.defs.js";

// ── Character ──

export type CharacterProfile = Omit<
  _CharacterProfile,
  "$type" | "attributes" | "derived" | "extensions" | "homeServer" | "createdAt" | "updatedAt"
> & {
  $type?: string;
  attributes: Attributes;
  derived?: DerivedStats;
  extensions?: Extensions;
  homeServer?: string;
  createdAt: string;
  updatedAt?: string;
};

// ── System schema definitions ──

export type AttributeDef = Omit<_AttributeDef, "$type"> & { $type?: string };

export type ClassDef = Omit<_ClassDef, "$type" | "baseAttributes" | "attributeBonuses"> & {
  $type?: string;
  baseAttributes?: Attributes;
  attributeBonuses?: Attributes;
};

export type SpellDef = Omit<_SpellDef, "$type" | "effect" | "target"> & {
  $type?: string;
  effect: "damage" | "heal" | "buff" | "debuff";
  target: "enemy" | "self" | "ally";
};

export type RaceDef = Omit<_RaceDef, "$type" | "attributeBonuses"> & {
  $type?: string;
  attributeBonuses?: Attributes;
};

export type EquipSlotDef = Omit<_EquipSlotDef, "$type"> & { $type?: string };

export type ItemTypeDef = Omit<_ItemTypeDef, "$type"> & { $type?: string };

// Re-export PropertyDef directly (no l. types)
export type PropertyDef = Omit<_PropertyDef, "$type"> & { $type?: string };

export type FormulaDef = Omit<_FormulaDef, "$type"> & { $type?: string };

// ── World ──

export type Direction =
  | "north"
  | "south"
  | "east"
  | "west"
  | "up"
  | "down"
  | "northeast"
  | "northwest"
  | "southeast"
  | "southwest";

export type RoomExit = Omit<_RoomExit, "$type" | "direction"> & {
  $type?: string;
  direction: Direction;
};

export type { Coordinates as RoomCoordinates } from "./lexicons/com/cacheblasters/realms/world/room.defs.js";

export type RoomRecord = Omit<_RoomRecord, "$type" | "exits"> & {
  $type?: string;
  exits?: RoomExit[];
};

export type { LevelRange } from "./lexicons/com/cacheblasters/realms/world/area.defs.js";

export type AreaRecord = Omit<_AreaRecord, "$type"> & { $type?: string };

export type ServerRecord = Omit<
  _ServerRecord,
  "$type" | "endpoint" | "xrpcEndpoint" | "createdAt"
> & {
  $type?: string;
  endpoint: string;
  xrpcEndpoint?: string;
  createdAt: string;
};

export type FlagEffect = Omit<_FlagEffect, "$type"> & { $type?: string };

export type FlagRecord = Omit<_FlagRecord, "$type"> & { $type?: string };

export type PortalRecord = Omit<_PortalRecord, "$type" | "direction"> & {
  $type?: string;
  direction: Direction;
};

// ── Chat ──

export type ChatMessage = Omit<_ChatMessage, "$type" | "createdAt"> & {
  $type?: string;
  createdAt: string;
};

// ── Federation ──

export type FederationRegistration = Omit<
  _FederationRegistration,
  "$type" | "createdAt" | "updatedAt"
> & {
  $type?: string;
  createdAt: string;
  updatedAt?: string;
};

// ── Items ──

export type ItemDefinition = Omit<_ItemDefinition, "$type" | "properties"> & {
  $type?: string;
  properties?: ItemProperties;
};

// ── NPCs ──

export type NpcBehavior = "hostile" | "merchant" | "questgiver" | "wanderer" | "static";

export interface DialogueNode {
  text: string;
  responses?: DialogueResponse[];
}

export interface DialogueResponse {
  text: string;
  next?: string;
}

export type NpcDefinition = Omit<
  _NpcDefinition,
  "$type" | "behavior" | "attributes" | "dialogue"
> & {
  $type?: string;
  behavior: NpcBehavior;
  attributes?: Attributes;
  dialogue?: Record<string, DialogueNode>;
};

// ── Quests ──

export type ObjectiveType = "kill" | "collect" | "talk" | "visit" | "deliver";
export type QuestStatus = "active" | "completed" | "failed";

export type QuestObjective = Omit<_QuestObjective, "$type" | "type"> & {
  $type?: string;
  type: ObjectiveType;
};

export type QuestRewards = Omit<_QuestRewards, "$type"> & { $type?: string };

export type QuestDefinition = Omit<_QuestDefinition, "$type" | "objectives"> & {
  $type?: string;
  objectives: QuestObjective[];
};

export type QuestObjectiveProgress = Omit<_QuestObjectiveProgress, "$type"> & { $type?: string };

export type QuestProgress = Omit<
  _QuestProgress,
  "$type" | "status" | "acceptedAt" | "completedAt"
> & {
  $type?: string;
  status: QuestStatus;
  acceptedAt: string;
  completedAt?: string;
};

// ── Crafting ──

export type RecipeIngredient = Omit<_RecipeIngredient, "$type"> & { $type?: string };

export type RecipeOutput = Omit<_RecipeOutput, "$type"> & { $type?: string };

export type RecipeDef = Omit<_RecipeDef, "$type" | "ingredients" | "output"> & {
  $type?: string;
  ingredients: RecipeIngredient[];
  output: RecipeOutput;
};

// ── NSID constants ──

export const NSID = {
  // Character
  CharacterProfile: "com.cacheblasters.realms.character.profile",

  // System schema
  SystemAttribute: "com.cacheblasters.realms.system.attribute",
  SystemClass: "com.cacheblasters.realms.system.class",
  SystemRace: "com.cacheblasters.realms.system.race",
  SystemSpell: "com.cacheblasters.realms.system.spell",
  SystemEquipSlot: "com.cacheblasters.realms.system.equipSlot",
  SystemItemType: "com.cacheblasters.realms.system.itemType",
  SystemFormula: "com.cacheblasters.realms.system.formula",

  // World
  WorldServer: "com.cacheblasters.realms.world.server",
  WorldArea: "com.cacheblasters.realms.world.area",
  WorldRoom: "com.cacheblasters.realms.world.room",
  WorldFlag: "com.cacheblasters.realms.world.flag",
  WorldPortal: "com.cacheblasters.realms.world.portal",

  // Items
  ItemDefinition: "com.cacheblasters.realms.item.definition",

  // NPCs
  NpcDefinition: "com.cacheblasters.realms.npc.definition",

  // Quests
  QuestDefinition: "com.cacheblasters.realms.quest.definition",
  QuestProgress: "com.cacheblasters.realms.quest.progress",

  // Crafting
  CraftRecipe: "com.cacheblasters.realms.craft.recipe",

  // Chat
  ChatMessage: "com.cacheblasters.realms.chat.message",
  ChatRelay: "com.cacheblasters.realms.chat.relay",
  ChatLocatePlayer: "com.cacheblasters.realms.chat.locatePlayer",

  // Federation
  FederationRegistration: "com.cacheblasters.realms.federation.registration",
  FederationTransfer: "com.cacheblasters.realms.federation.transfer",

  // Actions
  ActionConnect: "com.cacheblasters.realms.action.connect",
} as const;

// ── Re-export generated namespace for direct access ──
export * as lexicons from "./lexicons/index.js";
