import type {
  Attributes,
  ItemProperties,
  ItemTypeDef,
  EquipSlotDef,
  SpellDef,
} from "@realms/lexicons";
import type { ItemInstance } from "../types/item.js";

/** Subset of GameSystem needed for equipment resolution */
export interface EquipmentConfig {
  equipSlots: Record<string, EquipSlotDef>;
  itemTypes: Record<string, ItemTypeDef>;
}

// ── Action Point Costs ──

export const AP_COST = {
  attack: 2,
  defend: 1,
  flee: 3,
  useItem: 2,
  castDefault: 2,
} as const;

// ── Dice ──

// Dice notation arrives from untrusted federated records; unbounded values
// would let a hostile record spin the roll loop and block the event loop.
const MAX_DICE_COUNT = 100;
const MAX_DICE_SIDES = 1000;

export function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

export function rollDice(count: number, sides: number): number {
  const boundedCount = Math.min(count, MAX_DICE_COUNT);
  const boundedSides = Math.min(sides, MAX_DICE_SIDES);
  let total = 0;
  for (let i = 0; i < boundedCount; i++) {
    total += Math.floor(Math.random() * boundedSides) + 1;
  }
  return total;
}

// ── Attribute Modifiers ──

export function attrMod(value: number): number {
  return Math.floor((value - 10) / 2);
}

function getAttr(attrs: Attributes | undefined, key: string, fallback: number = 10): number {
  return attrs?.[key] ?? fallback;
}

// ── Equipment Helpers ──

/**
 * Resolve the equip slot for an item, driven by server's system config.
 *
 * Priority:
 * 1. Explicit `properties.slot` if it's a valid slot ID
 * 2. Tag matching — if a tag matches a slot ID in the config
 * 3. Item type's `defaultSlot`
 * 4. null (not equippable)
 */
export function getEquipSlot(
  config: EquipmentConfig,
  type: string,
  properties?: ItemProperties,
  tags?: string[],
): string | null {
  const typeDef = config.itemTypes[type];

  // Not equippable if the type isn't registered or isn't marked equippable
  if (!typeDef?.equippable) return null;

  // Priority 1: Explicit slot in properties
  if (properties?.slot && typeof properties.slot === "string") {
    if (config.equipSlots[properties.slot]) return properties.slot;
  }

  // Priority 2: Tag matches a slot ID (e.g., tag "head" matches slot "head")
  if (tags) {
    const validSlots = typeDef.equipSlots;
    for (const tag of tags) {
      if (config.equipSlots[tag]) {
        // If the item type restricts which slots it can go in, enforce that
        if (!validSlots || validSlots.includes(tag)) return tag;
      }
    }
  }

  // Priority 3: Item type's default slot
  if (typeDef.defaultSlot && config.equipSlots[typeDef.defaultSlot]) {
    return typeDef.defaultSlot;
  }

  return null;
}

/**
 * Build a map of alias -> slot ID from the equip slot config.
 * Includes the slot ID itself and its name (lowercased) as aliases.
 */
export function buildSlotAliases(config: EquipmentConfig): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const [slotId, def] of Object.entries(config.equipSlots)) {
    aliases[slotId.toLowerCase()] = slotId;
    aliases[def.name.toLowerCase()] = slotId;
    if (def.aliases) {
      for (const alias of def.aliases) {
        aliases[alias.toLowerCase()] = slotId;
      }
    }
  }
  return aliases;
}

export function getEquippedDefense(equipment: Record<string, ItemInstance>): number {
  let total = 0;
  for (const item of Object.values(equipment)) {
    const defense = item.properties?.defense;
    if (typeof defense === "number") total += defense;
  }
  return total;
}

export function getWeaponDamage(equipment: Record<string, ItemInstance>): number {
  // This will have to handle dual wielding and two-handed weapons eventually, but for now we assume a single main hand weapon or unarmed.
  const weapon = equipment.mainHand;
  if (weapon?.properties?.damage && typeof weapon.properties.damage === "number") {
    return weapon.properties.damage;
  }
  return 1; // unarmed
}

export function getWeaponName(equipment: Record<string, ItemInstance>): string {
  // Might be fun for races with natural weapons to have a different unarmed attack name, but for now we just return "fists" if no weapon equipped.
  return equipment.mainHand?.name ?? "fists";
}

export function getWeaponSpeed(equipment: Record<string, ItemInstance>): string {
  const speed = equipment.mainHand?.properties?.speed;
  return typeof speed === "string" ? speed : "medium";
}

// ── Attack Resolution ──

export interface AttackResult {
  hit: boolean;
  critical: boolean;
  roll: number;
  attackBonus: number;
  totalAttack: number;
  defense: number;
  damage: number;
  weaponName: string;
}

export function resolvePlayerAttack(
  playerAttrs: Attributes,
  playerEquipment: Record<string, ItemInstance>,
  npcAttrs: Attributes | undefined,
  _npcLevel: number,
): AttackResult {
  const roll = rollD20();
  const critical = roll === 20;

  // Attack bonus: use higher of str/dex modifier (finesse-style)
  // In the future we could have weapon-specific bonuses
  // (e.g. bows use dex, heavy weapons use str, maybe even some weapons using other attributes),
  // but for now we just take the best of both.
  const strMod = attrMod(getAttr(playerAttrs, "str"));
  const dexMod = attrMod(getAttr(playerAttrs, "dex"));
  const attackBonus = Math.max(strMod, dexMod);
  const totalAttack = roll + attackBonus;

  // NPC defense: 10 + dex modifier
  // We could also factor in armor or other defenses here, but for now we keep it simple.
  const npcDexMod = attrMod(getAttr(npcAttrs, "dex"));
  const defense = 10 + npcDexMod;

  const hit = critical || totalAttack >= defense;

  // Damage: weapon damage + best modifier (min 1)
  let damage = 0;
  if (hit) {
    const weaponDmg = getWeaponDamage(playerEquipment);
    damage = Math.max(1, weaponDmg + attackBonus);
    if (critical) damage *= 2;
  }

  return {
    hit,
    critical,
    roll,
    attackBonus,
    totalAttack,
    defense,
    damage,
    weaponName: getWeaponName(playerEquipment),
  };
}

/** Calculate NPC attack against a player */
export function resolveNpcAttack(
  npcAttrs: Attributes | undefined,
  npcLevel: number,
  npcName: string,
  playerAttrs: Attributes,
  playerEquipment: Record<string, ItemInstance>,
): AttackResult {
  const roll = rollD20();
  const critical = roll === 20;

  // NPC attack bonus: dex modifier + level bonus
  // For simplicity, we use dex for NPC attack bonus, but we could also have some NPCs use str or other attributes depending on their type.
  const npcDexMod = attrMod(getAttr(npcAttrs, "dex"));
  const attackBonus = npcDexMod + Math.floor(npcLevel / 2);
  const totalAttack = roll + attackBonus;

  // Player defense: 10 + dex modifier + armor
  const playerDexMod = attrMod(getAttr(playerAttrs, "dex"));
  const armorDefense = getEquippedDefense(playerEquipment);
  const defense = 10 + playerDexMod + armorDefense;

  const hit = critical || totalAttack >= defense;

  // NPC damage: level-based + str modifier
  let damage = 0;
  if (hit) {
    const npcStrMod = attrMod(getAttr(npcAttrs, "str"));
    const baseDamage = npcLevel * 2 + npcStrMod;
    damage = Math.max(1, baseDamage);
    if (critical) damage *= 2;
  }

  return {
    hit,
    critical,
    roll,
    attackBonus,
    totalAttack,
    defense,
    damage,
    weaponName: npcName, // NPC's "weapon" is itself
  };
}

// ── XP and Leveling ──

/** Calculate XP reward for defeating an NPC */
export function calculateXpReward(npcLevel: number, playerLevel: number): number {
  const baseXp = npcLevel * 15;
  const levelDiff = npcLevel - playerLevel;

  let modifier = 1.0;
  if (levelDiff > 0) {
    modifier = 1.0 + levelDiff * 0.1; // +10% per level above
  } else if (levelDiff < 0) {
    modifier = Math.max(0.1, 1.0 + levelDiff * 0.2); // -20% per level below, min 10%
  }

  return Math.max(1, Math.floor(baseXp * modifier));
}

/** XP needed to reach a given level (total cumulative) */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return level * (level - 1) * 50;
}

/** XP needed from current level to next level */
export function xpToNextLevel(currentLevel: number, currentXp: number): number {
  return Math.max(0, xpForLevel(currentLevel + 1) - currentXp);
}

/** Check if player should level up, returns new level */
export function checkLevelUp(currentLevel: number, totalXp: number): number {
  let level = currentLevel;
  while (totalXp >= xpForLevel(level + 1)) {
    level++;
  }
  return level;
}

// ── Flee Check ──

/** Attempt to flee combat. Returns true if successful. */
export function attemptFlee(playerDex: number, npcLevel: number): boolean {
  const roll = rollD20();
  const dexMod = attrMod(playerDex);
  const target = 10 + npcLevel;
  return roll + dexMod >= target;
}

// ── Spell Resolution ──

export interface SpellResult {
  success: boolean;
  critical: boolean;
  roll: number;
  spellBonus: number;
  totalRoll: number;
  defense: number;
  amount: number;
  spellName: string;
  effect: SpellDef["effect"];
}

/**
 * Parse dice notation like "2d6" into {count, sides}.
 * Returns null for invalid or out-of-range notation.
 */
function parseDice(notation: string): { count: number; sides: number } | null {
  const match = notation.match(/^(\d+)d(\d+)$/);
  if (!match) return null;
  const count = parseInt(match[1]);
  const sides = parseInt(match[2]);
  if (count < 1 || count > MAX_DICE_COUNT || sides < 1 || sides > MAX_DICE_SIDES) return null;
  return { count, sides };
}

/**
 * Resolve an offensive spell cast against a target.
 * Attack spells: d20 + attribute mod vs target AC. Damage = power + dice + attribute mod.
 */
export function resolveSpellAttack(
  spell: SpellDef,
  casterAttrs: Attributes,
  targetAttrs: Attributes | undefined,
  _targetLevel: number,
): SpellResult {
  const roll = rollD20();
  const critical = roll === 20;

  const castMod = attrMod(getAttr(casterAttrs, spell.attribute));
  const spellBonus = castMod;
  const totalRoll = roll + spellBonus;

  // Target defense: 10 + dex modifier (same as melee)
  const targetDexMod = attrMod(getAttr(targetAttrs, "dex"));
  const defense = 10 + targetDexMod;

  const success = critical || totalRoll >= defense;

  let amount = 0;
  if (success) {
    amount = spell.power + castMod;
    if (spell.dice) {
      const dice = parseDice(spell.dice);
      if (dice) amount += rollDice(dice.count, dice.sides);
    }
    amount = Math.max(1, amount);
    if (critical) amount *= 2;
  }

  return {
    success,
    critical,
    roll,
    spellBonus,
    totalRoll,
    defense,
    amount,
    spellName: spell.name,
    effect: spell.effect,
  };
}

/**
 * Resolve a self-targeted spell (heal, buff). Always succeeds.
 * Amount = power + dice + attribute mod.
 */
export function resolveSpellSelf(spell: SpellDef, casterAttrs: Attributes): SpellResult {
  const castMod = attrMod(getAttr(casterAttrs, spell.attribute));

  let amount = spell.power + castMod;
  if (spell.dice) {
    const dice = parseDice(spell.dice);
    if (dice) amount += rollDice(dice.count, dice.sides);
  }
  amount = Math.max(1, amount);

  return {
    success: true,
    critical: false,
    roll: 0,
    spellBonus: castMod,
    totalRoll: 0,
    defense: 0,
    amount,
    spellName: spell.name,
    effect: spell.effect,
  };
}

export function formatSpellResult(
  casterName: string,
  targetName: string,
  result: SpellResult,
  targetHp: number,
  targetMaxHp: number,
): string {
  const lines: string[] = [];

  if (result.effect === "heal") {
    lines.push(`${casterName} casts ${result.spellName}!`);
    lines.push(`  Restored ${result.amount} HP. ${targetName} HP: ${targetHp}/${targetMaxHp}`);
    return lines.join("\n");
  }

  // Attack spells
  if (result.critical) {
    lines.push(`${casterName} casts ${result.spellName} — CRITICAL SURGE!`);
  } else if (result.success) {
    lines.push(`${casterName} casts ${result.spellName} at ${targetName}.`);
  } else {
    lines.push(`${casterName} casts ${result.spellName} at ${targetName}, but it fizzles!`);
  }

  lines.push(
    `  Roll: ${result.roll} + ${result.spellBonus} = ${result.totalRoll} vs AC ${result.defense} — ${result.success ? "Hit!" : "Miss!"}`,
  );

  if (result.success) {
    lines.push(`  ${result.amount} damage dealt. ${targetName} HP: ${targetHp}/${targetMaxHp}`);
  }

  return lines.join("\n");
}

// ── Combat Narrative Formatting ──

export function formatAttackResult(
  attackerName: string,
  targetName: string,
  result: AttackResult,
  targetHp: number,
  targetMaxHp: number,
): string {
  const lines: string[] = [];

  if (result.critical) {
    lines.push(`${attackerName} lands a CRITICAL HIT on ${targetName} with ${result.weaponName}!`);
  } else if (result.hit) {
    lines.push(`${attackerName} attacks ${targetName} with ${result.weaponName}.`);
  } else {
    lines.push(`${attackerName} swings at ${targetName} with ${result.weaponName} but misses!`);
  }

  lines.push(
    `  Roll: ${result.roll} + ${result.attackBonus} = ${result.totalAttack} vs AC ${result.defense} — ${result.hit ? "Hit!" : "Miss!"}`,
  );

  if (result.hit) {
    lines.push(`  ${result.damage} damage dealt. ${targetName} HP: ${targetHp}/${targetMaxHp}`);
  }

  return lines.join("\n");
}
