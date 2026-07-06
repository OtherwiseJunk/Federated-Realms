import type { ParsedCommand } from "@realms/common";
import type {
  CharacterSession,
  WorldManager,
  SessionManager,
  BlueskyBridge,
  CombatSystem,
  PortalHandler,
  ChatRelayService,
} from "@realms/server-sdk";
import { handleMovement } from "./movement.js";
import { handleLook, handleTalk } from "./interaction.js";
import { handleSocial, handleTell } from "./social.js";
import { handleInventory } from "./inventory.js";
import { handleCombat } from "./combat.js";
import { handleEquipment } from "./equipment.js";
import { handleMerchant } from "./merchant.js";
import { handleMap, generateMapData } from "./map.js";
import {
  handleQuest,
  handleQuestList,
  handleAcceptQuest,
  handleAbandonQuest,
  handleTurnIn,
} from "./quest.js";
import { handleCrafting } from "./crafting.js";
import { encodeMessage, type ServerMessage } from "@realms/protocol";
import { getCommandHelp, xpToNextLevel } from "@realms/common";

export interface CommandContext {
  session: CharacterSession;
  world: WorldManager;
  sessions: SessionManager;
  broadcast: (roomId: string, msg: ServerMessage, excludeSessionId?: string) => void;
  bluesky: BlueskyBridge;
  combat: CombatSystem;
  portalHandler?: PortalHandler;
  chatRelay?: ChatRelayService;
}

export function handleCommand(cmd: ParsedCommand, ctx: CommandContext): void {
  const { session } = ctx;

  // Block most actions during combat (except combat commands, look, inventory, equipment, stats)
  if (session.inCombat) {
    const allowedInCombat = new Set([
      "attack",
      "kill",
      "defend",
      "flee",
      "retreat",
      "use",
      "cast",
      "spells",
      "look",
      "inventory",
      "equipment",
      "stats",
      "help",
      "map",
      "",
      "quest",
      "quests",
      "log",
      "tell",
    ]);
    if (!allowedInCombat.has(cmd.verb)) {
      if (cmd.verb === "go") {
        sendNarrative(session, "You can't move while in combat! Use 'flee' to escape.", "error");
      } else {
        sendNarrative(session, "You're in combat! Fight, flee, or use an item.", "error");
      }
      return;
    }
  }

  switch (cmd.verb) {
    case "go":
      handleMovement(cmd, ctx);
      break;

    case "look":
      handleLook(cmd, ctx);
      break;

    case "talk":
      handleTalk(cmd, ctx);
      break;

    case "say":
    case "shout":
    case "whisper":
      handleSocial(cmd, ctx);
      break;

    case "tell":
      handleTell(cmd, ctx);
      break;

    case "inventory":
    case "take":
    case "drop":
    case "examine":
      handleInventory(cmd, ctx);
      break;

    case "attack":
    case "kill":
    case "defend":
    case "flee":
    case "retreat":
    case "use":
    case "cast":
    case "spells":
      handleCombat(cmd, ctx);
      break;

    case "equip":
    case "wear":
    case "wield":
    case "unequip":
    case "remove":
    case "equipment":
      handleEquipment(cmd, ctx);
      break;

    case "shop":
    case "buy":
    case "sell":
      handleMerchant(cmd, ctx);
      break;

    case "map":
      handleMap(ctx);
      break;

    case "quests":
      handleQuestList(cmd, ctx);
      break;

    case "quest":
    case "log":
      handleQuest(cmd, ctx);
      break;

    case "accept":
      handleAcceptQuest(cmd, ctx);
      break;

    case "abandon":
      handleAbandonQuest(cmd, ctx);
      break;

    case "turnin":
    case "turn":
      handleTurnIn(cmd, ctx);
      break;

    case "recipes":
    case "recipe":
    case "craft":
    case "gather":
      handleCrafting(cmd, ctx);
      break;

    case "who":
      handleWho(ctx);
      break;

    case "stats":
      handleStats(ctx);
      break;

    case "help":
      sendNarrative(session, getCommandHelp().join("\n"), "system");
      break;

    case "":
      break;

    default:
      sendNarrative(
        session,
        `Unknown command: ${cmd.verb}. Type 'help' for a list of commands.`,
        "error",
      );
      break;
  }
}

function handleWho(ctx: CommandContext): void {
  const online = ctx.sessions.getAllSessions();
  if (online.length === 0) {
    sendNarrative(ctx.session, "No other adventurers are online.", "system");
    return;
  }

  const lines = ["Adventurers online:"];
  for (const s of online) {
    const room = ctx.world.getRoom(s.currentRoom);
    const combatStr = s.inCombat ? " [COMBAT]" : "";
    lines.push(
      `  ${s.name} - Level ${s.state.level} ${s.state.race} ${s.state.class} (${room?.title ?? "unknown"})${combatStr}`,
    );
  }
  sendNarrative(ctx.session, lines.join("\n"), "system");
}

function handleStats(ctx: CommandContext): void {
  const s = ctx.session.state;
  const system = ctx.world.gameSystem;

  const lines = [`${s.name} - Level ${s.level} ${s.race} ${s.class}`];
  lines.push(
    `HP: ${s.currentHp}/${s.maxHp}  MP: ${s.currentMp}/${s.maxMp}  AP: ${s.currentAp}/${s.maxAp}`,
  );
  lines.push(
    `Gold: ${s.gold}  XP: ${s.experience}  (${xpToNextLevel(s.level, s.experience)} to next level)`,
  );
  lines.push("");
  lines.push("Attributes:");
  for (const [id, value] of Object.entries(s.attributes)) {
    const def = system.attributes[id];
    const name = def?.name ?? id;
    lines.push(`  ${name}: ${value}`);
  }

  sendNarrative(ctx.session, lines.join("\n"), "system");
}

export function sendNarrative(
  session: CharacterSession,
  text: string,
  style: "info" | "error" | "combat" | "system" | "chat" = "info",
): void {
  session.send(encodeMessage({ type: "narrative", text, style }));
}

export function sendRoomState(session: CharacterSession, ctx: CommandContext): void {
  const room = ctx.world.getRoom(session.currentRoom);
  if (!room) {
    sendNarrative(session, "You are in a void. Something went wrong.", "error");
    return;
  }
  session.send(encodeMessage({ type: "room_state", room: room.toState() }));
}

export function sendMapUpdate(session: CharacterSession, ctx: CommandContext): void {
  const data = generateMapData(session, ctx.world);
  if (data) {
    session.send(
      encodeMessage({
        type: "map_update",
        grid: data.grid,
        cursorRow: data.cursorRow,
        cursorCol: data.cursorCol,
        legend: data.legend,
      }),
    );
  }
}
