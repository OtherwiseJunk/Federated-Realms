import type { ParsedCommand } from "@realms/common";
import { encodeMessage } from "@realms/protocol";
import { xpToNextLevel, createItemInstance } from "@realms/common";
import type { CommandContext } from "./index.js";
import { sendNarrative } from "./index.js";
import type { QuestManager } from "../systems/quest-manager.js";

export function handleQuest(cmd: ParsedCommand, ctx: CommandContext): void {
  const sub = (cmd.args[0] ?? "").toLowerCase();
  if (!sub || sub === "log") {
    showQuestLog(ctx);
  } else {
    showQuestDetail(cmd.args.join(" "), ctx);
  }
}

export function handleQuestList(cmd: ParsedCommand, ctx: CommandContext): void {
  const { session, world } = ctx;
  const room = world.getRoom(session.currentRoom);
  if (!room) return;

  // Check for questgiver/turnin NPC in room
  const npcs = world.npcManager.getAllInRoom(room.id);
  for (const npc of npcs) {
    const npcDef = world.npcManager.getDefinition(npc.definitionId);
    const behavior = npcDef?.behavior ?? "";
    if (behavior === "questgiver" || behavior === "static" || behavior === "merchant") {
      const available = world.questManager.getAvailableQuests(
        session.characterDid,
        npc.definitionId,
        session.state.level,
      );
      const completable = world.questManager.getCompletableQuests(
        session.characterDid,
        npc.definitionId,
      );
      if (available.length > 0 || completable.length > 0) {
        const npcName = npc.name;
        const lines: string[] = [];

        if (completable.length > 0) {
          lines.push(`${npcName} is waiting for you to turn in:`);
          for (const { def } of completable) {
            lines.push(`  \u2605 ${def.name} (type 'turnin' to complete)`);
          }
          lines.push("");
        }

        if (available.length > 0) {
          lines.push(`${npcName} has quests for you:`);
          for (const { def } of available) {
            const levelStr = def.level ? ` [Lv ${def.level}]` : "";
            lines.push(`  ! ${def.name}${levelStr} \u2014 ${def.description.split(".")[0]}.`);
            lines.push(`    (type 'accept ${def.name.toLowerCase()}' to accept)`);
          }
        }

        if (lines.length > 0) {
          sendNarrative(session, lines.join("\n"), "info");
          return;
        }
      }
    }
  }

  // No NPC context — show active quests
  showQuestLog(ctx);
}

export function handleAcceptQuest(cmd: ParsedCommand, ctx: CommandContext): void {
  const { session, world } = ctx;
  const questName = cmd.args.join(" ").toLowerCase();

  if (!questName) {
    sendNarrative(session, "Accept which quest? Type 'quests' to see available quests.", "error");
    return;
  }

  const room = world.getRoom(session.currentRoom);
  if (!room) return;

  // Find a matching available quest from any NPC in the room
  const npcs = world.npcManager.getAllInRoom(room.id);
  for (const npc of npcs) {
    const available = world.questManager.getAvailableQuests(
      session.characterDid,
      npc.definitionId,
      session.state.level,
    );
    const match = available.find(({ def }) => def.name.toLowerCase().includes(questName));
    if (match) {
      world.questManager.acceptQuest(session.characterDid, match.questId);
      const firstObj = match.def.objectives[0];
      const lines = [
        `You accept the quest: ${match.def.name}`,
        `Objective: ${firstObj?.description ?? "Begin the quest."}`,
      ];
      sendNarrative(session, lines.join("\n"), "system");
      sendQuestUpdate(session, world.questManager, match.questId);
      return;
    }
  }

  sendNarrative(
    session,
    `No quest matching '${questName}' available here. Type 'quests' to see what's available.`,
    "error",
  );
}

export function handleAbandonQuest(cmd: ParsedCommand, ctx: CommandContext): void {
  const { session, world } = ctx;
  const questName = cmd.args.join(" ").toLowerCase();

  if (!questName) {
    sendNarrative(session, "Abandon which quest?", "error");
    return;
  }

  const active = world.questManager.getActiveQuests(session.characterDid);
  const match = active.find(({ def }) => def.name.toLowerCase().includes(questName));

  if (!match) {
    sendNarrative(session, `You don't have an active quest matching '${questName}'.`, "error");
    return;
  }

  world.questManager.abandonQuest(session.characterDid, match.questId);
  sendNarrative(session, `You abandon the quest: ${match.def.name}.`, "info");
}

export function handleTurnIn(cmd: ParsedCommand, ctx: CommandContext): void {
  const { session, world } = ctx;
  const room = world.getRoom(session.currentRoom);
  if (!room) return;

  const npcs = world.npcManager.getAllInRoom(room.id);
  for (const npc of npcs) {
    const completable = world.questManager.getCompletableQuests(
      session.characterDid,
      npc.definitionId,
    );
    if (completable.length === 0) continue;

    // Complete the first completable quest
    const { questId, def } = completable[0];
    const completed = world.questManager.completeQuest(session.characterDid, questId);
    if (!completed) continue;

    // Attest quest completion
    session.attestations.recordQuestComplete(questId);

    const lines = [`\u2605 Quest Complete: ${def.name}!`];

    // Grant rewards
    const rewards = def.rewards;
    const rewardParts: string[] = [];
    if (rewards?.xp) {
      session.addXp(rewards.xp);
      rewardParts.push(`${rewards.xp} XP`);
    }
    if (rewards?.gold) {
      session.addGold(rewards.gold);
      rewardParts.push(`${rewards.gold} gold`);
    }
    if (rewards?.items?.length) {
      for (const itemId of rewards.items) {
        const itemDef = world.areaManager.getItemDefinition(itemId);
        if (itemDef) {
          const item = createItemInstance(itemId, itemDef, 1);
          session.addItem(item);
          session.attestations.recordItemGrant(itemId);
          rewardParts.push(item.name);
        }
      }
    }

    if (rewardParts.length > 0) {
      lines.push(`Rewards: ${rewardParts.join(", ")}`);
    }

    sendNarrative(session, lines.join("\n"), "system");

    // Send updated quest state
    sendQuestUpdate(session, world.questManager, questId, true);

    // Send character update for XP/gold changes
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

    // Send inventory update if items were granted
    if (rewards?.items?.length) {
      session.send(encodeMessage({ type: "inventory_update", inventory: session.inventory }));
    }

    return;
  }

  sendNarrative(session, "You have no completed quests to turn in here.", "info");
}

function showQuestLog(ctx: CommandContext): void {
  const { session, world } = ctx;
  const active = world.questManager.getActiveQuests(session.characterDid);

  if (active.length === 0) {
    sendNarrative(session, "You have no active quests. Talk to NPCs to find quests.", "info");
    return;
  }

  const lines = ["=== Quest Log ==="];
  for (let qi = 0; qi < active.length; qi++) {
    const { def, progress } = active[qi];
    lines.push(`[${qi + 1}] ${def.name}`);
    for (let i = 0; i < def.objectives.length; i++) {
      const obj = def.objectives[i];
      const prog = progress.objectives[i];
      const done = prog?.done ? "\u2713" : ">";
      const prevDone = i === 0 || progress.objectives.slice(0, i).every((p) => p.done);
      const locked = !prevDone && !prog?.done ? " [locked]" : "";
      const countStr = (obj.count ?? 1) > 1 ? ` (${prog?.current ?? 0}/${obj.count ?? 1})` : "";
      lines.push(`  ${done} ${obj.description}${countStr}${locked}`);
    }
  }

  sendNarrative(session, lines.join("\n"), "info");
}

function showQuestDetail(name: string, ctx: CommandContext): void {
  const { session, world } = ctx;
  const active = world.questManager.getActiveQuests(session.characterDid);
  const match = active.find(({ def }) => def.name.toLowerCase().includes(name.toLowerCase()));

  if (!match) {
    sendNarrative(session, `No active quest matching '${name}'.`, "error");
    return;
  }

  const { def, progress } = match;
  const lines = [def.name, def.description.trim(), ""];
  lines.push("Objectives:");
  for (let i = 0; i < def.objectives.length; i++) {
    const obj = def.objectives[i];
    const prog = progress.objectives[i];
    const done = prog?.done ? "\u2713" : "-";
    const countStr = (obj.count ?? 1) > 1 ? ` (${prog?.current ?? 0}/${obj.count ?? 1})` : "";
    lines.push(`  ${done} ${obj.description}${countStr}`);
  }
  if (def.rewards) {
    const parts: string[] = [];
    if (def.rewards.xp) parts.push(`${def.rewards.xp} XP`);
    if (def.rewards.gold) parts.push(`${def.rewards.gold} gold`);
    if (def.rewards.items?.length) parts.push(`${def.rewards.items.length} item(s)`);
    if (parts.length) lines.push(`\nRewards: ${parts.join(", ")}`);
  }
  sendNarrative(session, lines.join("\n"), "info");
}

export function sendQuestUpdate(
  session: { send(data: string): void; characterDid: string },
  questManager: QuestManager,
  questId: string,
  includeRewards = false,
): void {
  const payload = questManager.buildUpdatePayload(session.characterDid, questId, includeRewards);
  if (payload) session.send(encodeMessage(payload));
}
