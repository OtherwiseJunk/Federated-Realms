import { type ParsedCommand, AP_COST } from "@realms/common";
import type { CommandContext } from "./index.js";
import { sendNarrative } from "./index.js";

export function handleCombat(cmd: ParsedCommand, ctx: CommandContext): void {
  const { session } = ctx;
  const combat = ctx.combat;

  if (!combat) {
    sendNarrative(session, "Combat system unavailable.", "error");
    return;
  }

  switch (cmd.verb) {
    case "attack":
    case "kill": {
      const target = cmd.args.join(" ") || undefined;
      combat.attack(session, target);
      break;
    }

    case "defend": {
      combat.defend(session);
      break;
    }

    case "flee":
    case "retreat": {
      combat.flee(session);
      break;
    }

    case "use": {
      const itemName = cmd.args.join(" ");
      if (!itemName) {
        sendNarrative(session, "Use what? Specify an item.", "error");
        return;
      }
      combat.useItem(session, itemName);
      break;
    }

    case "cast": {
      // Syntax: cast <spell> [target] or cast <spell> at <target>
      if (cmd.args.length === 0) {
        sendNarrative(
          session,
          "Cast what? Specify a spell name. Type 'spells' to see your list.",
          "error",
        );
        return;
      }

      // Handle "cast fireball at goblin" or "cast fireball goblin"
      const atIndex = cmd.args.indexOf("at");
      let spellName: string;
      let targetName: string | undefined;

      if (atIndex > 0) {
        spellName = cmd.args.slice(0, atIndex).join(" ");
        targetName = cmd.args.slice(atIndex + 1).join(" ") || undefined;
      } else if (cmd.args.length === 1) {
        spellName = cmd.args[0];
      } else {
        // Try: first word is spell, rest is target
        // But also handle multi-word spells like "lesser heal"
        // Strategy: try full args as spell first, then split
        const fullName = cmd.args.join(" ");
        const system = ctx.world.gameSystem;
        const lower = fullName.toLowerCase();
        const exactMatch = Object.entries(system.spells).find(
          ([id, def]) => id.toLowerCase() === lower || def.name.toLowerCase() === lower,
        );
        if (exactMatch) {
          spellName = fullName;
        } else {
          // Last word might be target
          spellName = cmd.args.slice(0, -1).join(" ");
          targetName = cmd.args[cmd.args.length - 1];
        }
      }

      combat.castSpell(session, spellName, targetName);
      break;
    }

    case "spells": {
      showSpells(session, ctx);
      break;
    }
  }
}

function showSpells(
  session: import("../entities/character-session.js").CharacterSession,
  ctx: CommandContext,
): void {
  const system = ctx.world.gameSystem;
  const classDef = system.classes[session.state.class];
  const spellIds = classDef?.spells ?? [];

  if (spellIds.length === 0) {
    sendNarrative(session, "Your class has no spells.", "info");
    return;
  }

  const lines = ["Your spells:"];
  for (const id of spellIds) {
    const spell = system.spells[id];
    if (!spell) continue;
    const levelReq =
      spell.levelRequired && spell.levelRequired > session.state.level
        ? ` [Requires level ${spell.levelRequired}]`
        : "";
    const apCost = spell.apCost ?? AP_COST.castDefault;
    lines.push(
      `  ${spell.name} — ${spell.mpCost} MP, ${apCost} AP — ${spell.description}${levelReq}`,
    );
  }
  lines.push("");
  lines.push(
    `Mana: ${session.state.currentMp}/${session.state.maxMp}  AP: ${session.state.currentAp}/${session.state.maxAp}`,
  );
  sendNarrative(session, lines.join("\n"), "info");
}
