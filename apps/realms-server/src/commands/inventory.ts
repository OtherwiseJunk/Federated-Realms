import type { ParsedCommand } from "@realms/common";
import { encodeMessage } from "@realms/protocol";
import type { CommandContext } from "./index.js";
import { sendNarrative } from "./index.js";

export function handleInventory(cmd: ParsedCommand, ctx: CommandContext): void {
  switch (cmd.verb) {
    case "inventory":
      showInventory(ctx);
      break;
    case "take":
    case "get":
      handleTake(cmd, ctx);
      break;
    case "drop":
      handleDrop(cmd, ctx);
      break;
    case "examine":
      handleExamine(cmd, ctx);
      break;
  }
}

function showInventory(ctx: CommandContext): void {
  const { session } = ctx;
  const items = session.inventory;

  if (items.length === 0) {
    sendNarrative(session, "You are not carrying anything.", "info");
    return;
  }

  const lines = ["You are carrying:"];
  for (const item of items) {
    const qty = item.quantity > 1 ? ` (x${item.quantity})` : "";
    lines.push(`  ${item.name}${qty}`);
  }
  sendNarrative(session, lines.join("\n"), "info");
}

function handleTake(cmd: ParsedCommand, ctx: CommandContext): void {
  const { session, world, broadcast } = ctx;
  const itemName = cmd.args.join(" ");

  if (!itemName) {
    sendNarrative(session, "Take what? Specify an item name.", "error");
    return;
  }

  const room = world.getRoom(session.currentRoom);
  if (!room) return;

  // Check for untakeable items before removing
  const groundItem = room.findGroundItem(itemName);
  if (groundItem?.properties?.untakeable) {
    sendNarrative(
      session,
      `You can't get ye ${groundItem.name.toLowerCase()}. It is firmly anchored to this plane of existence.`,
      "info",
    );
    return;
  }

  const item = room.removeGroundItem(itemName);
  if (!item) {
    sendNarrative(session, `You don't see '${itemName}' here.`, "error");
    return;
  }

  session.addItem(item);
  session.attestations.recordItemGrant(item.definitionId);

  // Quest collect tracking
  const collectUpdates = ctx.world.questManager.recordCollect(
    session.characterDid,
    item.definitionId,
    item.quantity,
  );
  for (const questId of collectUpdates) {
    const payload = ctx.world.questManager.buildUpdatePayload(session.characterDid, questId);
    if (payload) session.send(encodeMessage(payload));
  }

  const qty = item.quantity > 1 ? ` (x${item.quantity})` : "";
  sendNarrative(session, `You pick up ${item.name}${qty}.`, "info");

  // Notify others in the room
  broadcast(
    session.currentRoom,
    {
      type: "narrative",
      text: `${session.name} picks up ${item.name}${qty}.`,
      style: "info",
    },
    session.sessionId,
  );

  // Send updated inventory
  sendInventoryUpdate(ctx);
}

function handleDrop(cmd: ParsedCommand, ctx: CommandContext): void {
  const { session, world, broadcast } = ctx;
  const itemName = cmd.args.join(" ");

  if (!itemName) {
    sendNarrative(session, "Drop what? Specify an item name.", "error");
    return;
  }

  const room = world.getRoom(session.currentRoom);
  if (!room) return;

  const item = session.removeItem(itemName);
  if (!item) {
    sendNarrative(session, `You don't have '${itemName}'.`, "error");
    return;
  }

  const def = world.areaManager.getItemDefinition(item.definitionId);
  room.addGroundItem(item, def?.stackable ?? false);

  const qty = item.quantity > 1 ? ` (x${item.quantity})` : "";
  sendNarrative(session, `You drop ${item.name}${qty}.`, "info");

  // Notify others
  broadcast(
    session.currentRoom,
    {
      type: "narrative",
      text: `${session.name} drops ${item.name}${qty}.`,
      style: "info",
    },
    session.sessionId,
  );

  // Send updated inventory
  sendInventoryUpdate(ctx);
}

function handleExamine(cmd: ParsedCommand, ctx: CommandContext): void {
  const { session, world } = ctx;
  const itemName = cmd.args.join(" ");

  if (!itemName) {
    sendNarrative(session, "Examine what?", "error");
    return;
  }

  // Check inventory first, then ground
  let item = session.findItem(itemName);

  if (!item) {
    const room = world.getRoom(session.currentRoom);
    item = room?.findGroundItem(itemName);
  }

  if (!item) {
    // Check room features (notice board, fountain, etc.)
    const room = world.getRoom(session.currentRoom);
    const feature = room?.findFeature(itemName);
    if (feature) {
      sendNarrative(session, `${feature.name}\n${feature.description.trim()}`, "info");
      return;
    }
    sendNarrative(session, `You don't see '${itemName}' anywhere.`, "error");
    return;
  }

  // Look up the full definition for a detailed description
  const def = world.areaManager.getItemDefinition(item.definitionId);
  if (!def) {
    sendNarrative(session, `${item.name} — no further details available.`, "info");
    return;
  }

  const lines = [def.name];
  lines.push(def.description.trim());
  if (def.type) lines.push(`Type: ${def.type}`);
  if (def.rarity) lines.push(`Rarity: ${def.rarity}`);
  if (def.weight) lines.push(`Weight: ${def.weight}`);
  if (def.value) lines.push(`Value: ${def.value} gold`);
  if (def.levelRequired && def.levelRequired > 1)
    lines.push(`Requires level: ${def.levelRequired}`);
  if (def.tags?.length) lines.push(`Tags: ${def.tags.join(", ")}`);

  sendNarrative(session, lines.join("\n"), "info");
}

function sendInventoryUpdate(ctx: CommandContext): void {
  ctx.session.send(encodeMessage({ type: "inventory_update", inventory: ctx.session.inventory }));
}
