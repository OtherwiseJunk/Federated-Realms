import type { ParsedCommand } from "@realms/common";
import { createItemInstance, xpToNextLevel } from "@realms/common";
import { encodeMessage } from "@realms/protocol";
import type { CharacterSession } from "@realms/server-sdk";
import type { CommandContext } from "./index.js";
import { sendNarrative } from "./index.js";

const SELL_MULTIPLIER = 0.5; // sell at 50% of item value

export function handleMerchant(cmd: ParsedCommand, ctx: CommandContext): void {
  switch (cmd.verb) {
    case "shop":
      handleShop(ctx);
      break;
    case "buy":
      handleBuy(cmd, ctx);
      break;
    case "sell":
      handleSell(cmd, ctx);
      break;
  }
}

function findMerchantInRoom(ctx: CommandContext) {
  const { session, world } = ctx;
  const npcs = world.npcManager.getAllInRoom(session.currentRoom);
  for (const npc of npcs) {
    if (npc.behavior === "merchant") {
      const def = world.npcManager.getDefinition(npc.definitionId);
      if (def?.shop && def.shop.length > 0) {
        return { npc, def };
      }
    }
  }
  return null;
}

function handleShop(ctx: CommandContext): void {
  const { session, world } = ctx;

  const merchant = findMerchantInRoom(ctx);
  if (!merchant) {
    sendNarrative(session, "There's no merchant here to trade with.", "error");
    return;
  }

  const { npc, def } = merchant;
  const lines = [`${npc.name}'s wares:`];

  for (const itemId of def.shop!) {
    const itemDef = world.areaManager.getItemDefinition(itemId);
    if (!itemDef) continue;
    lines.push(`  ${itemDef.name} — ${itemDef.value ?? 0} gold`);
  }

  lines.push("");
  lines.push(`Your gold: ${session.gold}`);
  lines.push("Use 'buy <item>' to purchase or 'sell <item>' to sell.");

  sendNarrative(session, lines.join("\n"), "info");
}

function handleBuy(cmd: ParsedCommand, ctx: CommandContext): void {
  const { session, world } = ctx;
  const itemName = cmd.args.join(" ");

  if (!itemName) {
    sendNarrative(
      session,
      "Buy what? Specify an item name. Use 'shop' to see what's available.",
      "error",
    );
    return;
  }

  const merchant = findMerchantInRoom(ctx);
  if (!merchant) {
    sendNarrative(session, "There's no merchant here to buy from.", "error");
    return;
  }

  const { npc, def } = merchant;
  const lower = itemName.toLowerCase();

  // Find the item in the shop
  let matchedId: string | undefined;
  let matchedDef;
  for (const shopItemId of def.shop!) {
    const itemDef = world.areaManager.getItemDefinition(shopItemId);
    if (itemDef && itemDef.name.toLowerCase().includes(lower)) {
      matchedId = shopItemId;
      matchedDef = itemDef;
      break;
    }
  }

  if (!matchedId || !matchedDef) {
    sendNarrative(
      session,
      `${npc.name} doesn't sell '${itemName}'. Use 'shop' to see available items.`,
      "error",
    );
    return;
  }

  const price = matchedDef.value ?? 0;
  if (price <= 0) {
    sendNarrative(session, `${matchedDef.name} is not for sale.`, "error");
    return;
  }

  if (!session.spendGold(price)) {
    sendNarrative(
      session,
      `You can't afford ${matchedDef.name} (costs ${price} gold, you have ${session.gold}).`,
      "error",
    );
    return;
  }

  // Create item instance and add to inventory
  const item = createItemInstance(matchedId, matchedDef, 1);
  session.addItem(item);
  session.attestations.recordItemGrant(matchedId);

  sendNarrative(
    session,
    `You buy ${matchedDef.name} from ${npc.name} for ${price} gold. (${session.gold} gold remaining)`,
    "info",
  );

  sendCharacterAndInventory(session);
}

function handleSell(cmd: ParsedCommand, ctx: CommandContext): void {
  const { session, world } = ctx;
  const itemName = cmd.args.join(" ");

  if (!itemName) {
    sendNarrative(session, "Sell what? Specify an item from your inventory.", "error");
    return;
  }

  const merchant = findMerchantInRoom(ctx);
  if (!merchant) {
    sendNarrative(session, "There's no merchant here to sell to.", "error");
    return;
  }

  const { npc } = merchant;

  // Find item in player inventory
  const item = session.findItem(itemName);
  if (!item) {
    sendNarrative(session, `You don't have '${itemName}'.`, "error");
    return;
  }

  const itemDef = world.areaManager.getItemDefinition(item.definitionId);
  const baseValue = itemDef?.value ?? 0;
  const sellPrice = Math.max(1, Math.floor(baseValue * SELL_MULTIPLIER));

  if (baseValue <= 0) {
    sendNarrative(session, `${npc.name} isn't interested in ${item.name}.`, "info");
    return;
  }

  // Remove one from inventory and add gold
  session.removeItem(itemName, 1);
  session.addGold(sellPrice);

  sendNarrative(
    session,
    `You sell ${item.name} to ${npc.name} for ${sellPrice} gold. (${session.gold} gold)`,
    "info",
  );

  sendCharacterAndInventory(session);
}

function sendCharacterAndInventory(session: CharacterSession): void {
  const s = session.state;
  session.send(
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
  session.send(encodeMessage({ type: "inventory_update", inventory: session.inventory }));
}
