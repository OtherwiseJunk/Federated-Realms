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

// ── Enum validation ──

/**
 * Assert that a value read from content (e.g. YAML) is one of a lexicon enum's
 * known values, throwing with caller-supplied context (file + id) when it is
 * not. Lexicon `knownValues` are an open set, so the generated validators
 * accept unknown strings; content-authoring typos must fail the boot, not the
 * player. Returns the value narrowed to the enum type on success.
 */
export function assertEnumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  context: string,
): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(
    `${context}: invalid value ${JSON.stringify(value)} (expected one of: ${allowed.join(", ")})`,
  );
}

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

export const SPELL_EFFECTS = ["damage", "heal", "buff", "debuff"] as const;
export type SpellEffect = (typeof SPELL_EFFECTS)[number];

export const SPELL_TARGETS = ["enemy", "self", "ally"] as const;
export type SpellTarget = (typeof SPELL_TARGETS)[number];

export type SpellDef = Omit<_SpellDef, "$type" | "effect" | "target"> & {
  $type?: string;
  effect: SpellEffect;
  target: SpellTarget;
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

export const DIRECTIONS = [
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
] as const;
export type Direction = (typeof DIRECTIONS)[number];

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

export type ItemDefinition = Omit<
  _ItemDefinition,
  "$type" | "properties" | "stackable" | "maxStack"
> & {
  $type?: string;
  properties?: ItemProperties;
  /** Required in-memory; record readers apply the lexicon default (false) when absent */
  stackable: boolean;
  /** Required in-memory; record readers derive the default (stackable ? 99 : 1) when absent */
  maxStack: number;
};

// ── NPCs ──

export const NPC_BEHAVIORS = ["hostile", "merchant", "questgiver", "wanderer", "static"] as const;
export type NpcBehavior = (typeof NPC_BEHAVIORS)[number];

// Object type aliases (not interfaces) so they carry an implicit index
// signature and stay assignable to the lexicon's open `LexMap` dialogue field
// when publishing records.
export type DialogueNode = {
  text: string;
  responses?: DialogueResponse[];
};

export type DialogueResponse = {
  text: string;
  next?: string;
};

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

export const OBJECTIVE_TYPES = ["kill", "collect", "talk", "visit", "deliver"] as const;
export type ObjectiveType = (typeof OBJECTIVE_TYPES)[number];
export type QuestStatus = "active" | "completed" | "failed";

export type QuestObjective = Omit<_QuestObjective, "$type" | "type" | "count"> & {
  $type?: string;
  type: ObjectiveType;
  /** Required in-memory; record readers apply the lexicon default (1) when absent */
  count: number;
};

export type QuestRewards = Omit<_QuestRewards, "$type"> & { $type?: string };

export type QuestDefinition = Omit<
  _QuestDefinition,
  "$type" | "objectives" | "ordered" | "consumeItems" | "repeatable"
> & {
  $type?: string;
  objectives: QuestObjective[];
  /** Required in-memory; record readers apply the lexicon default (true) when absent */
  ordered: boolean;
  /** Required in-memory; record readers apply the lexicon default (true) when absent */
  consumeItems: boolean;
  /** Required in-memory; record readers apply the lexicon default (false) when absent */
  repeatable: boolean;
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
