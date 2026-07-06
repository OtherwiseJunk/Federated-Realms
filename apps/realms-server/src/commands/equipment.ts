import type { ParsedCommand } from "@realms/common";
import {
  getEquipSlot,
  buildSlotAliases,
  getEquippedDefense,
  getWeaponDamage,
  xpToNextLevel,
} from "@realms/common";
import type { EquipmentConfig } from "@realms/common";
import { encodeMessage } from "@realms/protocol";
import type { CommandContext } from "./index.js";
import { sendNarrative } from "./index.js";

export function handleEquipment(cmd: ParsedCommand, ctx: CommandContext): void {
  switch (cmd.verb) {
    case "equip":
    case "wear":
    case "wield":
      handleEquip(cmd, ctx);
      break;
    case "unequip":
    case "remove":
      handleUnequip(cmd, ctx);
      break;
    case "equipment":
      showEquipment(ctx);
      break;
  }
}

function getConfig(ctx: CommandContext): EquipmentConfig {
  return ctx.world.gameSystem;
}

function handleEquip(cmd: ParsedCommand, ctx: CommandContext): void {
  const { session, world } = ctx;
  const itemName = cmd.args.join(" ");

  if (!itemName) {
    sendNarrative(session, "Equip what? Specify an item from your inventory.", "error");
    return;
  }

  // Find item in inventory
  const item = session.findItem(itemName);
  if (!item) {
    sendNarrative(session, `You don't have '${itemName}'.`, "error");
    return;
  }

  // Look up definition to determine slot
  const def = world.areaManager.getItemDefinition(item.definitionId);
  if (!def) {
    sendNarrative(session, `${item.name} doesn't seem equippable.`, "error");
    return;
  }

  const config = getConfig(ctx);
  const slot = getEquipSlot(config, def.type, def.properties, def.tags);
  if (!slot) {
    sendNarrative(session, `${item.name} is not equippable.`, "error");
    return;
  }

  // Check level requirement
  if (def.levelRequired && session.state.level < def.levelRequired) {
    sendNarrative(
      session,
      `You need to be level ${def.levelRequired} to equip ${item.name}.`,
      "error",
    );
    return;
  }

  // Remove from inventory (take 1)
  const removed = session.removeItem(itemName, 1);
  if (!removed) {
    sendNarrative(session, `Failed to equip ${item.name}.`, "error");
    return;
  }

  // Unequip existing item in that slot
  const previous = session.unequip(slot);
  if (previous) {
    session.addItem(previous);
    sendNarrative(session, `You unequip ${previous.name}.`, "info");
  }

  // Equip the new item
  session.equip(slot, { ...removed, quantity: 1 });

  const slotName = config.equipSlots[slot]?.name ?? slot;
  sendNarrative(session, `You equip ${removed.name} (${slotName}).`, "info");
  sendUpdates(ctx);
}

function handleUnequip(cmd: ParsedCommand, ctx: CommandContext): void {
  const { session } = ctx;
  const slotOrName = cmd.args.join(" ");

  if (!slotOrName) {
    sendNarrative(session, "Unequip what? Specify an item or slot.", "error");
    return;
  }

  const lower = slotOrName.toLowerCase();
  const config = getConfig(ctx);

  // Try as slot alias first (data-driven)
  const aliases = buildSlotAliases(config);
  let slot = aliases[lower];

  // If not a slot alias, search equipment by item name
  if (!slot) {
    for (const [s, item] of Object.entries(session.equipment)) {
      if (item.name.toLowerCase().includes(lower)) {
        slot = s;
        break;
      }
    }
  }

  if (!slot) {
    sendNarrative(session, `You don't have '${slotOrName}' equipped.`, "error");
    return;
  }

  const item = session.unequip(slot);
  if (!item) {
    sendNarrative(session, `Nothing equipped in that slot.`, "error");
    return;
  }

  session.addItem(item);
  sendNarrative(session, `You unequip ${item.name}.`, "info");
  sendUpdates(ctx);
}

function showEquipment(ctx: CommandContext): void {
  const { session } = ctx;
  const eq = session.equipment;
  const config = getConfig(ctx);

  // Build slot display list from config (preserves insertion order from YAML)
  const slots = Object.entries(config.equipSlots).map(([key, def]) => ({
    key,
    label: def.name,
  }));

  const lines = ["Equipment:"];
  for (const { key, label } of slots) {
    const item = eq[key];
    if (item) {
      const props: string[] = [];
      if (item.properties?.damage) props.push(`damage: ${item.properties.damage}`);
      if (item.properties?.defense) props.push(`defense: ${item.properties.defense}`);
      if (item.properties?.bonus_hp) props.push(`+${item.properties.bonus_hp} HP`);
      if (item.properties?.bonus_mp) props.push(`+${item.properties.bonus_mp} MP`);
      if (item.properties?.bonus_ap) props.push(`+${item.properties.bonus_ap} AP`);
      const propStr = props.length > 0 ? ` (${props.join(", ")})` : "";
      lines.push(`  ${label}: ${item.name}${propStr}`);
    } else {
      lines.push(`  ${label}: —`);
    }
  }

  // Also show equipped slots not in the config (shouldn't happen, but defensive)
  for (const [key, item] of Object.entries(eq)) {
    if (!config.equipSlots[key]) {
      lines.push(`  ${key}: ${item.name}`);
    }
  }

  // Summary
  const totalDefense = getEquippedDefense(eq);
  const weaponDmg = getWeaponDamage(eq);
  lines.push("");
  lines.push(`Weapon damage: ${weaponDmg} | Armor defense: ${totalDefense}`);

  sendNarrative(session, lines.join("\n"), "info");
}

function sendUpdates(ctx: CommandContext): void {
  const s = ctx.session.state;
  ctx.session.send(encodeMessage({ type: "inventory_update", inventory: ctx.session.inventory }));
  ctx.session.send(encodeMessage({ type: "equipment_update", equipment: ctx.session.equipment }));
  ctx.session.send(
    encodeMessage({
      type: "character_update",
      hp: s.currentHp,
      maxHp: s.maxHp,
      mp: s.currentMp,
      maxMp: s.maxMp,
      ap: s.currentAp,
      maxAp: s.maxAp,
      gold: s.gold,
      level: s.level,
      xp: s.experience,
      xpToNext: xpToNextLevel(s.level, s.experience),
    }),
  );
}
