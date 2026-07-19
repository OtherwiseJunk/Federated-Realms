import type {
  CharacterProfile,
  Attributes,
  DerivedStats,
  ClassDef,
  RaceDef,
  AttributeDef,
  FormulaDef,
  EquipSlotDef,
  ItemTypeDef,
  SpellDef,
} from "@realms/lexicons";
import type { ItemInstance } from "./item.js";
import { evaluateFormula } from "./formula.js";

export interface CharacterState extends CharacterProfile {
  currentHp: number;
  maxHp: number;
  currentMp: number;
  maxMp: number;
  currentAp: number;
  maxAp: number;
  gold: number;
  currentRoom: string;
  activeEffects: ActiveEffect[];
  inventory: ItemInstance[];
  equipment: Record<string, ItemInstance>;
}

export interface ActiveEffect {
  id: string;
  name: string;
  type: "buff" | "debuff";
  attribute?: string;
  magnitude: number;
  remainingTicks: number;
}

// ── Game System ──
// A GameSystem defines all the rules a server uses. It's loaded from the
// server's published system.* records, or from a bundled default.

export interface GameSystem {
  attributes: Record<string, AttributeDef>;
  classes: Record<string, ClassDef>;
  races: Record<string, RaceDef>;
  formulas: Record<string, FormulaDef>;
  equipSlots: Record<string, EquipSlotDef>;
  itemTypes: Record<string, ItemTypeDef>;
  spells: Record<string, SpellDef>;
  /**
   * Divisor applied to raw integer item weights for display. atproto's data
   * model has no float type, so item `weight` is stored as an integer in
   * 1/weightScale units (e.g. weightScale: 10 means stored weights are tenths —
   * a raw weight of 5 displays as 0.5). Each server/system declares its own
   * scale in system.yml; defaults to 1 (weights are whole units).
   */
  weightScale: number;
}

// Formula evaluation lives in ./formula.ts (a safe arithmetic parser — no code
// compilation). Re-exported below so it stays part of the package's public API.
export { evaluateFormula } from "./formula.js";

// ── Derived stat formula defaults ──
//
// The engine assumes a formula exists for every core derived stat (maxHp,
// maxMp, maxAp). When a formula is missing, derived-stat consumers are forced
// to fall back to already-mutated current values, which silently compounds
// equipment bonuses (issue #81). Rather than scatter fallbacks at every use
// site, we guarantee the invariant at the IO boundary: any system whose
// formulas omit a core stat is normalized to carry the reference default.
//
// These defaults mirror apps/realms-server/data/system.yml so the shipped
// reference server behaves identically whether or not it declares them.
export const DEFAULT_DERIVED_FORMULAS: Record<string, FormulaDef> = {
  maxHp: {
    name: "Max Hit Points",
    expression: "20 + (level - 1) * 8 + floor(con / 2)",
    min: 1,
  },
  maxMp: {
    name: "Max Mana Points",
    expression: "10 + (level - 1) * 4 + floor(int / 3)",
    min: 0,
  },
  maxAp: {
    name: "Max Action Points",
    expression: "4 + floor((dex - 10) / 4)",
    min: 2,
    max: 12,
  },
};

/**
 * Return a formula map guaranteed to define every core derived stat.
 * Formulas supplied by the caller always win; only missing core stats are
 * filled from {@link DEFAULT_DERIVED_FORMULAS}. The input is not mutated.
 */
export function withDefaultFormulas(
  formulas: Record<string, FormulaDef>,
): Record<string, FormulaDef> {
  const result: Record<string, FormulaDef> = { ...formulas };
  for (const [id, def] of Object.entries(DEFAULT_DERIVED_FORMULAS)) {
    if (!result[id]) result[id] = def;
  }
  return result;
}

// ── Derived stat computation ──

export function computeDerivedStats(
  formulas: Record<string, FormulaDef>,
  level: number,
  attributes: Attributes,
): DerivedStats {
  const variables: Record<string, number> = { level, ...attributes };
  const derived: DerivedStats = {};

  for (const [id, formula] of Object.entries(formulas)) {
    let value = evaluateFormula(formula.expression, variables);
    if (formula.min !== undefined) value = Math.max(value, formula.min);
    if (formula.max !== undefined) value = Math.min(value, formula.max);
    derived[id] = value;
  }

  return derived;
}

// ── Character creation ──

export function buildAttributes(system: GameSystem, classId: string, raceId: string): Attributes {
  const attrs: Attributes = {};

  // Start with default values from attribute definitions
  for (const [id, def] of Object.entries(system.attributes)) {
    attrs[id] = def.defaultValue ?? 10;
  }

  // Apply class bonuses
  const classDef = system.classes[classId];
  if (classDef?.attributeBonuses) {
    for (const [id, bonus] of Object.entries(classDef.attributeBonuses)) {
      attrs[id] = (attrs[id] ?? 0) + bonus;
    }
  }

  // Apply race bonuses
  const raceDef = system.races[raceId];
  if (raceDef?.attributeBonuses) {
    for (const [id, bonus] of Object.entries(raceDef.attributeBonuses)) {
      attrs[id] = (attrs[id] ?? 0) + bonus;
    }
  }

  return attrs;
}

export function profileToState(
  profile: CharacterProfile,
  currentRoom: string,
  formulas: Record<string, FormulaDef>,
): CharacterState {
  const derived = computeDerivedStats(formulas, profile.level, profile.attributes);

  return {
    ...profile,
    currentHp: derived.maxHp ?? 20,
    maxHp: derived.maxHp ?? 20,
    currentMp: derived.maxMp ?? 0,
    maxMp: derived.maxMp ?? 0,
    currentAp: derived.maxAp ?? 4,
    maxAp: derived.maxAp ?? 4,
    gold: 10, // starting gold
    currentRoom,
    activeEffects: [],
    inventory: [],
    equipment: {},
  };
}
