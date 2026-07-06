import type { ParsedCommand } from "@realms/common";
import type { CommandContext } from "./index.js";
import { sendNarrative, sendRoomState } from "./index.js";
import { encodeMessage } from "@realms/protocol";

export function handleLook(cmd: ParsedCommand, ctx: CommandContext): void {
  const { session, world } = ctx;

  if (!cmd.target) {
    // Look at the room
    sendRoomState(session, ctx);
    return;
  }

  const room = world.getRoom(session.currentRoom);
  if (!room) return;

  const state = room.toState();

  // Look at a player
  const targetPlayer = state.players.find(
    (p) => p.name.toLowerCase() === cmd.target!.toLowerCase(),
  );
  if (targetPlayer) {
    const targetSession = ctx.sessions.getSession(targetPlayer.id);
    if (targetSession) {
      const s = targetSession.state;
      sendNarrative(
        session,
        `${s.name} - Level ${s.level} ${s.race} ${s.class}\n${s.description ?? "You see nothing remarkable."}`,
        "info",
      );
      return;
    }
  }

  // Look at an NPC
  const targetNpc = state.npcs.find((n) =>
    n.name.toLowerCase().includes(cmd.target!.toLowerCase()),
  );
  if (targetNpc) {
    const npcInstance = ctx.world.npcManager.getInstance(targetNpc.id);
    if (npcInstance) {
      const def = ctx.world.npcManager.getDefinition(npcInstance.definitionId);
      if (def) {
        const lines = [def.name];
        lines.push(def.description.trim());
        if (def.level) lines.push(`Level: ${def.level}`);
        if (def.behavior) lines.push(`Demeanor: ${def.behavior}`);
        sendNarrative(session, lines.join("\n"), "info");
        return;
      }
    }
    sendNarrative(session, `You look at ${targetNpc.name}.`, "info");
    return;
  }

  // Look at a ground item
  const groundItem = room.findGroundItem(cmd.target!);
  if (groundItem) {
    const def = world.areaManager.getItemDefinition(groundItem.definitionId);
    if (def) {
      const qty = groundItem.quantity > 1 ? ` (x${groundItem.quantity})` : "";
      sendNarrative(session, `${def.name}${qty}\n${def.description.trim()}`, "info");
    } else {
      sendNarrative(session, `You see ${groundItem.name} lying here.`, "info");
    }
    return;
  }

  // Look at an exit direction
  const exit = state.exits.find((e) => e.direction === cmd.target!.toLowerCase());
  if (exit) {
    sendNarrative(
      session,
      exit.description ?? `You see an exit leading ${exit.direction}.`,
      "info",
    );
    return;
  }

  // Look at a room feature (notice board, fountain, etc.)
  const feature = room.findFeature(cmd.target!);
  if (feature) {
    sendNarrative(session, `${feature.name}\n${feature.description.trim()}`, "info");
    return;
  }

  sendNarrative(session, `You don't see '${cmd.target}' here.`, "error");
}

export function handleTalk(cmd: ParsedCommand, ctx: CommandContext): void {
  const { session, world } = ctx;
  const target = cmd.args[0];

  if (!target) {
    sendNarrative(session, "Talk to whom?", "error");
    return;
  }

  const room = world.getRoom(session.currentRoom);
  if (!room) return;

  // Find NPC by name
  const npc = world.npcManager.findInRoom(room.id, target);
  if (!npc) {
    sendNarrative(session, `You don't see '${target}' here to talk to.`, "error");
    return;
  }

  const def = world.npcManager.getDefinition(npc.definitionId);
  if (!def?.dialogue) {
    sendNarrative(session, `${npc.name} doesn't seem interested in talking.`, "info");
    return;
  }

  // Check for a specific dialogue node (e.g., "talk marta rumors")
  const nodeKey = cmd.args.length > 1 ? cmd.args.slice(1).join("_") : "greeting";
  const node = def.dialogue[nodeKey] ?? def.dialogue.greeting;

  if (!node) {
    sendNarrative(session, `${npc.name} has nothing to say.`, "info");
    return;
  }

  // Format the dialogue
  const lines = [`${npc.name} says:`];
  lines.push(`"${node.text.trim()}"`);

  if (node.responses && node.responses.length > 0) {
    lines.push("");
    lines.push("You could respond:");
    for (let i = 0; i < node.responses.length; i++) {
      const r = node.responses[i];
      const hint = r.next ? ` (talk ${target.toLowerCase()} ${r.next})` : "";
      lines.push(`  ${i + 1}. ${r.text}${hint}`);
    }
  }

  // Quest talk tracking
  const talkUpdates = ctx.world.questManager.recordTalk(session.characterDid, npc.definitionId);
  for (const questId of talkUpdates) {
    const payload = ctx.world.questManager.buildUpdatePayload(session.characterDid, questId);
    if (payload) session.send(encodeMessage(payload));
  }

  sendNarrative(session, lines.join("\n"), "chat");
}
