/**
 * Combat System — Server-side combat encounter management.
 *
 * Handles the full combat lifecycle:
 * - Starting encounters (player attacks or NPC aggros)
 * - Multi-NPC combat: all hostile NPCs in a room fight together
 * - Resolving player actions (attack, defend, flee, use item, cast)
 * - NPC retaliation: ALL combat NPCs attack after each player action
 * - Death handling (player respawn, NPC loot/XP/respawn)
 *
 * Each player action produces a batched narrative (all events in one message)
 * so that clients receive the full round result atomically.
 */

import type { CharacterSession } from "../entities/character-session.js";
import type { WorldManager } from "../world/world-manager.js";
import type { SessionManager } from "../server/session-manager.js";
import type { NpcInstance } from "@realms/common";
import type { ServerMessage } from "@realms/protocol";
import {
  resolvePlayerAttack,
  resolveNpcAttack,
  resolveSpellAttack,
  resolveSpellSelf,
  formatAttackResult,
  formatSpellResult,
  calculateXpReward,
  attemptFlee,
  xpToNextLevel,
  AP_COST,
} from "@realms/common";
import type { SpellDef } from "@realms/lexicons";
import { encodeMessage, type CombatantInfo } from "@realms/protocol";

export interface CombatContext {
  world: WorldManager;
  sessions: SessionManager;
  broadcast: (roomId: string, msg: ServerMessage, excludeSessionId?: string) => void;
}

export class CombatSystem {
  private ctx: CombatContext;

  constructor(ctx: CombatContext) {
    this.ctx = ctx;
  }

  // ── Combat Helpers ──

  /** Get all NPCs in combat state in the player's room */
  private getCombatNpcs(session: CharacterSession): NpcInstance[] {
    return this.ctx.world.npcManager
      .getAllInRoom(session.currentRoom)
      .filter((npc) => npc.state === "combat");
  }

  /** Set all idle hostile NPCs in the room to combat state */
  private engageAllHostiles(session: CharacterSession): void {
    const hostiles = this.ctx.world.npcManager
      .getAllInRoom(session.currentRoom)
      .filter((npc) => npc.behavior === "hostile" && npc.state === "idle");
    for (const npc of hostiles) {
      npc.state = "combat";
    }
  }

  /** All combat NPCs in the room retaliate against the player. Returns narrative lines. */
  private allNpcsRetaliate(session: CharacterSession): string[] {
    const combatNpcs = this.getCombatNpcs(session);
    if (combatNpcs.length === 0) return [];

    // Apply defend bonus before all attacks
    const originalDex = session.state.attributes.dex ?? 10;
    if (session.isDefending) {
      session.state.attributes.dex = originalDex + 8; // +4 AC = +8 dex
    }

    const allLines: string[] = [];
    for (const npc of combatNpcs) {
      const npcAttack = resolveNpcAttack(
        npc.attributes,
        npc.level,
        npc.name,
        session.state.attributes,
        session.state.equipment,
      );

      if (npcAttack.hit) {
        session.takeDamage(npcAttack.damage);
      }

      const narrative = formatAttackResult(
        npc.name,
        session.name,
        npcAttack,
        session.state.currentHp,
        session.state.maxHp,
      );

      if (allLines.length > 0) allLines.push("");
      allLines.push(...narrative.split("\n"));

      if (session.isDead) break; // stop if player dies mid-round
    }

    // Restore dex and clear defend
    if (session.isDefending) {
      session.state.attributes.dex = originalDex;
      session.isDefending = false;
    }

    return allLines;
  }

  /** Find the next alive combat NPC to auto-target after current target dies */
  private findNextTarget(session: CharacterSession): NpcInstance | undefined {
    return this.getCombatNpcs(session).find((npc) => npc.currentHp > 0);
  }

  /** Reset all combat NPCs in a room back to idle */
  private resetAllCombatNpcs(session: CharacterSession): void {
    for (const npc of this.getCombatNpcs(session)) {
      npc.state = "idle";
    }
  }

  /** Public: reset all combat NPCs and clear player combat state (e.g. on disconnect) */
  disengageAll(session: CharacterSession): void {
    this.resetAllCombatNpcs(session);
    session.combatTarget = null;
  }

  // ── Public Combat Actions ──

  /** Hostile NPC initiates combat with a player on room entry */
  npcAggro(session: CharacterSession, npc: NpcInstance): void {
    if (session.inCombat) return; // already fighting something

    const { broadcast } = this.ctx;

    session.combatTarget = npc.instanceId;
    npc.state = "combat";
    session.isDefending = false;
    session.refreshAp();

    // Engage ALL hostile NPCs in the room
    this.engageAllHostiles(session);

    session.send(
      encodeMessage({
        type: "combat_start",
        target: npc.name,
        combatants: this.buildCombatantInfo(session),
      }),
    );

    const lines: string[] = [];
    const combatNpcs = this.getCombatNpcs(session);
    if (combatNpcs.length > 1) {
      const names = combatNpcs.map((n) => n.name).join(" and ");
      lines.push(`${names} attack you!`);
    } else {
      lines.push(`${npc.name} attacks you!`);
    }

    // All combat NPCs get a free opening attack
    const retaliationLines = this.allNpcsRetaliate(session);
    lines.push(...retaliationLines);

    this.sendCombat(session, lines.join("\n"));
    broadcast(
      session.currentRoom,
      {
        type: "narrative",
        text: `${combatNpcs.map((n) => n.name).join(" and ")} attacks ${session.name}!`,
        style: "combat",
      },
      session.sessionId,
    );
    this.sendCharacterUpdate(session);
    this.sendCombatUpdate(session);

    if (session.isDead) {
      this.handlePlayerDeath(session, npc);
    }
  }

  /** Player attacks an NPC */
  attack(session: CharacterSession, targetName?: string): void {
    const { world, broadcast } = this.ctx;
    const room = world.getRoom(session.currentRoom);
    if (!room) return;

    if (room.isSafe()) {
      this.sendCombat(session, "This is a safe zone. Combat is not allowed here.");
      return;
    }

    // Determine target
    let npc: NpcInstance | undefined;

    if (targetName) {
      npc = world.npcManager.findInRoom(room.id, targetName);
      if (!npc) {
        this.sendCombat(session, `You don't see '${targetName}' here to attack.`);
        return;
      }
    } else if (session.combatTarget) {
      npc = world.npcManager.getInstance(session.combatTarget);
      if (!npc || npc.state === "dead") {
        // Try to find another combat NPC
        npc = this.findNextTarget(session);
        if (!npc) {
          session.combatTarget = null;
          this.sendCombat(session, "Your target is no longer here. Combat ended.");
          this.sendCombatEnd(session, "victory");
          return;
        }
        session.combatTarget = npc.instanceId;
      }
    } else {
      this.sendCombat(session, "Attack what? Specify a target.");
      return;
    }

    // Start combat if not already in it
    const combatStarting = !session.inCombat;
    if (combatStarting) {
      session.combatTarget = npc.instanceId;
      npc.state = "combat";
      session.refreshAp();
      // Engage all hostile NPCs in the room
      this.engageAllHostiles(session);
      session.send(
        encodeMessage({
          type: "combat_start",
          target: npc.name,
          combatants: this.buildCombatantInfo(session),
        }),
      );
      broadcast(
        room.id,
        {
          type: "narrative",
          text: `${session.name} engages ${npc.name} in combat!`,
          style: "combat",
        },
        session.sessionId,
      );
    } else {
      // Refresh AP at the start of each round
      session.refreshAp();
      if (session.combatTarget !== npc.instanceId) {
        session.combatTarget = npc.instanceId;
        npc.state = "combat";
      }
    }

    // Check AP
    if (!session.spendAp(AP_COST.attack)) {
      this.sendCombat(
        session,
        `Not enough AP to attack. Need ${AP_COST.attack}, have ${session.state.currentAp}.`,
      );
      return;
    }

    session.isDefending = false;

    // Build combined narrative for the whole exchange
    const lines: string[] = [];

    // Resolve player attack
    const attackResult = resolvePlayerAttack(
      session.state.attributes,
      session.state.equipment,
      npc.attributes,
      npc.level,
    );

    if (attackResult.hit) {
      world.npcManager.damageNpc(npc.instanceId, attackResult.damage);
    }

    lines.push(formatAttackResult(session.name, npc.name, attackResult, npc.currentHp, npc.maxHp));

    // Check if NPC died
    if (npc.currentHp <= 0) {
      const deathLines = this.handleNpcDeath(session, npc);
      lines.push(...deathLines);

      // If combat continues (other NPCs remain), all remaining NPCs retaliate
      if (session.inCombat) {
        const retaliationLines = this.allNpcsRetaliate(session);
        if (retaliationLines.length > 0) {
          lines.push("", ...retaliationLines);
        }
      }

      this.sendCombat(session, lines.join("\n"));
      broadcast(
        room.id,
        { type: "narrative", text: lines.join("\n"), style: "combat" },
        session.sessionId,
      );
      this.sendCombatUpdate(session);

      if (session.isDead) {
        const killer = this.getCombatNpcs(session)[0] ?? npc;
        this.handlePlayerDeath(session, killer);
      }
      return;
    }

    // All combat NPCs retaliate
    const retaliationLines = this.allNpcsRetaliate(session);
    lines.push("", ...retaliationLines);

    // Send combined narrative
    this.sendCombat(session, lines.join("\n"));
    broadcast(
      room.id,
      { type: "narrative", text: lines.join("\n"), style: "combat" },
      session.sessionId,
    );
    this.sendCharacterUpdate(session);
    this.sendCombatUpdate(session);

    // Check if player died
    if (session.isDead) {
      const killer = this.getCombatNpcs(session)[0] ?? npc;
      this.handlePlayerDeath(session, killer);
    }
  }

  /** Player defends (reduces incoming damage for this round) */
  defend(session: CharacterSession): void {
    if (!session.inCombat) {
      this.sendCombat(session, "You're not in combat.");
      return;
    }

    // Check current target is alive
    const currentNpc = this.ctx.world.npcManager.getInstance(session.combatTarget!);
    if (!currentNpc || currentNpc.state === "dead") {
      const next = this.findNextTarget(session);
      if (!next) {
        session.combatTarget = null;
        this.sendCombat(session, "Your target is gone. Combat ended.");
        this.sendCombatEnd(session, "victory");
        return;
      }
      session.combatTarget = next.instanceId;
    }

    // Refresh AP at start of round, then spend
    session.refreshAp();
    if (!session.spendAp(AP_COST.defend)) {
      this.sendCombat(
        session,
        `Not enough AP to defend. Need ${AP_COST.defend}, have ${session.state.currentAp}.`,
      );
      return;
    }

    session.isDefending = true;
    const lines: string[] = [];
    lines.push("You raise your guard, bracing for the next attack. (+4 AC)");

    // All combat NPCs attack
    const retaliationLines = this.allNpcsRetaliate(session);
    lines.push("", ...retaliationLines);

    this.sendCombat(session, lines.join("\n"));
    this.sendCharacterUpdate(session);
    this.sendCombatUpdate(session);

    if (session.isDead) {
      const killer = this.getCombatNpcs(session)[0] ?? currentNpc!;
      this.handlePlayerDeath(session, killer);
    }
  }

  /** Player attempts to flee */
  flee(session: CharacterSession): void {
    if (!session.inCombat) {
      this.sendCombat(session, "You're not in combat. Just walk away.");
      return;
    }

    // Refresh AP at start of round, then spend
    session.refreshAp();
    if (!session.spendAp(AP_COST.flee)) {
      this.sendCombat(
        session,
        `Not enough AP to flee. Need ${AP_COST.flee}, have ${session.state.currentAp}.`,
      );
      return;
    }

    const { broadcast } = this.ctx;
    const dex = session.state.attributes.dex ?? 10;

    // Flee DC is based on the highest-level combatant
    const combatNpcs = this.getCombatNpcs(session);
    const maxLevel = Math.max(...combatNpcs.map((n) => n.level), 1);
    const escaped = attemptFlee(dex, maxLevel);

    if (escaped) {
      this.sendCombat(session, "You disengage and escape from combat!");
      broadcast(
        session.currentRoom,
        { type: "narrative", text: `${session.name} flees from combat!`, style: "combat" },
        session.sessionId,
      );

      // All NPCs return to idle
      this.resetAllCombatNpcs(session);
      session.combatTarget = null;
      session.isDefending = false;
      this.sendCombatEnd(session, "flee");
    } else {
      const lines: string[] = [];
      lines.push("You try to flee but can't get away!");

      // All combat NPCs retaliate on failed flee
      const retaliationLines = this.allNpcsRetaliate(session);
      if (retaliationLines.length > 0) {
        lines.push("", ...retaliationLines);
      }

      this.sendCombat(session, lines.join("\n"));
      this.sendCharacterUpdate(session);
      this.sendCombatUpdate(session);

      if (session.isDead) {
        const killer =
          combatNpcs[0] ?? this.ctx.world.npcManager.getInstance(session.combatTarget!)!;
        this.handlePlayerDeath(session, killer);
      }
    }
  }

  /** Player uses a consumable item (in or out of combat) */
  useItem(session: CharacterSession, itemName: string): void {
    const item = session.findItem(itemName);
    if (!item) {
      this.sendCombat(session, `You don't have '${itemName}'.`);
      return;
    }

    const def = this.ctx.world.areaManager.getItemDefinition(item.definitionId);
    if (!def || def.type !== "consumable") {
      this.sendCombat(session, `You can't use ${item.name}.`);
      return;
    }

    // AP check in combat
    if (session.inCombat) {
      session.refreshAp();
      if (!session.spendAp(AP_COST.useItem)) {
        this.sendCombat(
          session,
          `Not enough AP to use an item. Need ${AP_COST.useItem}, have ${session.state.currentAp}.`,
        );
        return;
      }
    }

    const props = def.properties ?? {};
    const lines: string[] = [];

    // Handle different effects
    if (props.effect === "restore_hp" && typeof props.healAmount === "number") {
      const oldHp = session.state.currentHp;
      session.heal(props.healAmount);
      const healed = session.state.currentHp - oldHp;
      session.removeItem(itemName, 1);
      lines.push(
        `You use ${item.name}, restoring ${healed} HP. (HP: ${session.state.currentHp}/${session.state.maxHp})`,
      );
    } else if (props.effect === "restore_mp" && typeof props.manaAmount === "number") {
      const oldMp = session.state.currentMp;
      session.restoreMana(props.manaAmount);
      const restored = session.state.currentMp - oldMp;
      session.removeItem(itemName, 1);
      lines.push(
        `You use ${item.name}, restoring ${restored} MP. (MP: ${session.state.currentMp}/${session.state.maxMp})`,
      );
    } else {
      lines.push(`You use ${item.name}. Nothing seems to happen.`);
      session.removeItem(itemName, 1);
    }

    // If in combat, all NPCs retaliate after item use
    if (session.inCombat) {
      const retaliationLines = this.allNpcsRetaliate(session);
      if (retaliationLines.length > 0) {
        lines.push("", ...retaliationLines);
      }
    }

    this.sendCombat(session, lines.join("\n"));
    this.sendCharacterUpdate(session);
    this.sendInventoryUpdate(session);
    if (session.inCombat) this.sendCombatUpdate(session);

    if (session.isDead && session.inCombat) {
      const killer =
        this.getCombatNpcs(session)[0] ??
        this.ctx.world.npcManager.getInstance(session.combatTarget!)!;
      this.handlePlayerDeath(session, killer);
    }
  }

  /** Player casts a spell (in or out of combat) */
  castSpell(session: CharacterSession, spellName: string, targetName?: string): void {
    const { world } = this.ctx;
    const system = world.gameSystem;

    // Find the spell
    const lower = spellName.toLowerCase();
    const spellEntry = Object.entries(system.spells).find(
      ([id, def]) => id.toLowerCase() === lower || def.name.toLowerCase() === lower,
    );
    if (!spellEntry) {
      this.sendCombat(
        session,
        `Unknown spell: ${spellName}. Type 'spells' to see your spell list.`,
      );
      return;
    }
    const [spellId, spell] = spellEntry;

    // Check if class knows this spell
    const classDef = system.classes[session.state.class];
    if (!classDef?.spells?.includes(spellId)) {
      this.sendCombat(session, `Your class cannot cast ${spell.name}.`);
      return;
    }

    // Check level requirement
    if (spell.levelRequired && session.state.level < spell.levelRequired) {
      this.sendCombat(session, `You need level ${spell.levelRequired} to cast ${spell.name}.`);
      return;
    }

    // Check MP
    if (session.state.currentMp < spell.mpCost) {
      this.sendCombat(
        session,
        `Not enough mana. ${spell.name} costs ${spell.mpCost} MP (you have ${session.state.currentMp}).`,
      );
      return;
    }

    // Check AP in combat
    const apCost = spell.apCost ?? AP_COST.castDefault;
    if (session.inCombat) {
      session.refreshAp();
      if (!session.spendAp(apCost)) {
        this.sendCombat(
          session,
          `Not enough AP to cast ${spell.name}. Need ${apCost}, have ${session.state.currentAp}.`,
        );
        return;
      }
    }

    // Route by effect type
    if (spell.target === "self") {
      this.castSelfSpell(session, spell);
    } else if (spell.target === "enemy") {
      this.castAttackSpell(session, spell, targetName);
    } else {
      this.sendCombat(session, `You can't cast ${spell.name} right now.`);
    }
  }

  private castSelfSpell(session: CharacterSession, spell: SpellDef): void {
    // Spend MP
    session.state.currentMp -= spell.mpCost;

    const result = resolveSpellSelf(spell, session.state.attributes);
    const lines: string[] = [];

    if (spell.effect === "heal") {
      session.heal(result.amount);
      lines.push(
        formatSpellResult(
          session.name,
          session.name,
          result,
          session.state.currentHp,
          session.state.maxHp,
        ),
      );
      lines.push(
        `  (${spell.mpCost} MP spent, ${session.state.currentMp}/${session.state.maxMp} remaining)`,
      );
    } else if (spell.effect === "buff") {
      // Simple buff: +magnitude to str for 5 ticks
      lines.push(`${session.name} casts ${spell.name}! A surge of power flows through you.`);
      lines.push(`  +${result.amount} Strength for a short time. (${spell.mpCost} MP spent)`);
      session.state.activeEffects.push({
        id: `spell:${spell.name.toLowerCase().replace(/\s+/g, "-")}`,
        name: spell.name,
        type: "buff",
        attribute: "str",
        magnitude: result.amount,
        remainingTicks: 5,
      });
      // Apply immediately
      session.state.attributes.str = (session.state.attributes.str ?? 10) + result.amount;
    }

    // All combat NPCs retaliate if in combat
    if (session.inCombat) {
      const retaliationLines = this.allNpcsRetaliate(session);
      if (retaliationLines.length > 0) {
        lines.push("", ...retaliationLines);
      }
    }

    this.sendCombat(session, lines.join("\n"));
    this.sendCharacterUpdate(session);
    if (session.inCombat) this.sendCombatUpdate(session);

    if (session.isDead && session.inCombat) {
      const killer =
        this.getCombatNpcs(session)[0] ??
        this.ctx.world.npcManager.getInstance(session.combatTarget!)!;
      this.handlePlayerDeath(session, killer);
    }
  }

  private castAttackSpell(session: CharacterSession, spell: SpellDef, targetName?: string): void {
    const { world, broadcast } = this.ctx;
    const room = world.getRoom(session.currentRoom);
    if (!room) return;

    if (room.isSafe()) {
      this.sendCombat(session, "This is a safe zone. Combat is not allowed here.");
      return;
    }

    // Determine target
    let npc: NpcInstance | undefined;
    if (targetName) {
      npc = world.npcManager.findInRoom(room.id, targetName);
      if (!npc) {
        this.sendCombat(session, `You don't see '${targetName}' here to target.`);
        return;
      }
    } else if (session.combatTarget) {
      npc = world.npcManager.getInstance(session.combatTarget);
      if (!npc || npc.state === "dead") {
        npc = this.findNextTarget(session);
        if (!npc) {
          session.combatTarget = null;
          this.sendCombat(session, "Your target is no longer here.");
          this.sendCombatEnd(session, "victory");
          return;
        }
        session.combatTarget = npc.instanceId;
      }
    } else {
      this.sendCombat(session, `Cast ${spell.name} at whom? Specify a target.`);
      return;
    }

    // Start combat if not already in it
    const combatStarting = !session.inCombat;
    if (combatStarting) {
      session.combatTarget = npc.instanceId;
      npc.state = "combat";
      this.engageAllHostiles(session);
      session.send(
        encodeMessage({
          type: "combat_start",
          target: npc.name,
          combatants: this.buildCombatantInfo(session),
        }),
      );
      broadcast(
        room.id,
        {
          type: "narrative",
          text: `${session.name} engages ${npc.name} in combat!`,
          style: "combat",
        },
        session.sessionId,
      );
    } else if (session.combatTarget !== npc.instanceId) {
      session.combatTarget = npc.instanceId;
      npc.state = "combat";
    }

    session.isDefending = false;

    // Spend MP
    session.state.currentMp -= spell.mpCost;

    // Resolve spell attack
    const result = resolveSpellAttack(spell, session.state.attributes, npc.attributes, npc.level);

    if (result.success) {
      world.npcManager.damageNpc(npc.instanceId, result.amount);
    }

    const lines: string[] = [];
    lines.push(formatSpellResult(session.name, npc.name, result, npc.currentHp, npc.maxHp));
    lines.push(
      `  (${spell.mpCost} MP spent, ${session.state.currentMp}/${session.state.maxMp} remaining)`,
    );

    // Check if NPC died
    if (npc.currentHp <= 0) {
      const deathLines = this.handleNpcDeath(session, npc);
      lines.push(...deathLines);

      // Remaining NPCs still retaliate
      if (session.inCombat) {
        const retaliationLines = this.allNpcsRetaliate(session);
        if (retaliationLines.length > 0) {
          lines.push("", ...retaliationLines);
        }
      }

      this.sendCombat(session, lines.join("\n"));
      broadcast(
        room.id,
        { type: "narrative", text: lines.join("\n"), style: "combat" },
        session.sessionId,
      );
      this.sendCombatUpdate(session);

      if (session.isDead) {
        const killer = this.getCombatNpcs(session)[0] ?? npc;
        this.handlePlayerDeath(session, killer);
      }
      return;
    }

    // All combat NPCs retaliate
    const retaliationLines = this.allNpcsRetaliate(session);
    lines.push("", ...retaliationLines);

    this.sendCombat(session, lines.join("\n"));
    broadcast(
      room.id,
      { type: "narrative", text: lines.join("\n"), style: "combat" },
      session.sessionId,
    );
    this.sendCharacterUpdate(session);
    this.sendCombatUpdate(session);

    if (session.isDead) {
      const killer = this.getCombatNpcs(session)[0] ?? npc;
      this.handlePlayerDeath(session, killer);
    }
  }

  // ── Internal ──

  /** Handle NPC death. Returns narrative lines. May or may not end combat. */
  private handleNpcDeath(session: CharacterSession, npc: NpcInstance): string[] {
    const { world } = this.ctx;
    const room = world.getRoom(session.currentRoom);
    const lines: string[] = [];

    lines.push(`${npc.name} has been slain!`);

    // Generate and drop loot
    const getItemDef = (id: string) => world.areaManager.getItemDefinition(id);
    const loot = world.npcManager.generateLoot(npc.definitionId, getItemDef);
    if (loot.length > 0 && room) {
      const lootNames = loot.map((i) => i.name).join(", ");
      lines.push(`${npc.name} drops: ${lootNames}`);
      for (const item of loot) {
        const def = getItemDef(item.definitionId);
        room.addGroundItem(item, def?.stackable ?? false);
      }
    }

    // Award gold
    const goldDrop = world.npcManager.generateGoldDrop(npc.definitionId);
    if (goldDrop > 0) {
      session.addGold(goldDrop);
      lines.push(`You loot ${goldDrop} gold.`);
    }

    // Award XP
    const xp = calculateXpReward(npc.level, session.state.level);
    const newLevel = session.addXp(xp);
    lines.push(`You gain ${xp} XP.`);

    if (newLevel) {
      const levelMsg = `Congratulations! You've reached level ${newLevel}!`;
      lines.push(levelMsg);
      session.send(encodeMessage({ type: "level_up", level: newLevel, message: levelMsg }));
      if (room) {
        this.ctx.broadcast(
          room.id,
          {
            type: "narrative",
            text: `${session.name} has reached level ${newLevel}!`,
            style: "system",
          },
          session.sessionId,
        );
      }
    }

    // Kill the NPC (removes from room, queues respawn)
    if (room) {
      world.npcManager.killNpc(npc.instanceId, room);
    }

    // Quest kill tracking
    const killUpdates = this.ctx.world.questManager.recordKill(
      session.characterDid,
      npc.definitionId,
    );
    for (const questId of killUpdates) {
      const payload = this.ctx.world.questManager.buildUpdatePayload(session.characterDid, questId);
      if (payload) session.send(encodeMessage(payload));
    }

    // Check if other NPCs are still fighting
    const remaining = this.getCombatNpcs(session);
    if (remaining.length > 0) {
      // Auto-switch target to next hostile
      session.combatTarget = remaining[0].instanceId;
      lines.push(`You turn to face ${remaining[0].name}.`);
      this.sendCharacterUpdate(session);
    } else {
      // All hostiles dead — end combat
      session.combatTarget = null;
      session.isDefending = false;
      this.sendCombatEnd(session, "victory");
      this.sendCharacterUpdate(session);
    }

    return lines;
  }

  private handlePlayerDeath(session: CharacterSession, npc: NpcInstance): void {
    const { world, broadcast } = this.ctx;

    this.sendCombat(session, "You have been defeated! The world goes dark...");
    broadcast(
      session.currentRoom,
      {
        type: "narrative",
        text: `${session.name} has been defeated by ${npc.name}!`,
        style: "combat",
      },
      session.sessionId,
    );

    // Remove from current room
    const oldRoom = world.getRoom(session.currentRoom);
    if (oldRoom) {
      oldRoom.removePlayer(session.sessionId);
      broadcast(oldRoom.id, {
        type: "entity_leave",
        entity: { id: session.sessionId, name: session.name, type: "player" },
        room: oldRoom.id,
      });
    }

    // All NPCs return to idle
    this.resetAllCombatNpcs(session);

    // Respawn
    const spawnRoom = world.getDefaultSpawnRoom();
    session.respawn(spawnRoom);

    // Place in spawn room
    const newRoom = world.getRoom(spawnRoom);
    if (newRoom) {
      newRoom.addPlayer(session.sessionId, session.name);
      broadcast(
        newRoom.id,
        {
          type: "entity_enter",
          entity: { id: session.sessionId, name: session.name, type: "player" },
          room: newRoom.id,
        },
        session.sessionId,
      );
    }

    // End combat
    this.sendCombatEnd(session, "death");
    this.sendCharacterUpdate(session);

    // Send new room state
    if (newRoom) {
      session.send(encodeMessage({ type: "room_state", room: newRoom.toState() }));
    }

    this.sendCombat(
      session,
      `You awaken at ${newRoom?.title ?? "the town square"}, battered but alive.`,
    );
  }

  // ── Messaging helpers ──

  private sendCombat(session: CharacterSession, text: string): void {
    session.send(encodeMessage({ type: "narrative", text, style: "combat" }));
  }

  private sendCombatEnd(session: CharacterSession, reason: "victory" | "flee" | "death"): void {
    session.send(encodeMessage({ type: "combat_end", reason }));
  }

  private sendCharacterUpdate(session: CharacterSession): void {
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
  }

  private sendInventoryUpdate(session: CharacterSession): void {
    session.send(encodeMessage({ type: "inventory_update", inventory: session.inventory }));
  }

  /** Build CombatantInfo array for all active combat NPCs */
  private buildCombatantInfo(session: CharacterSession): CombatantInfo[] {
    const combatNpcs = this.getCombatNpcs(session);
    const npcMgr = this.ctx.world.npcManager;
    return combatNpcs.map((npc) => {
      const def = npcMgr.getDefinition(npc.definitionId);
      return {
        id: npc.instanceId,
        name: npc.name,
        level: npc.level,
        hp: npc.currentHp,
        maxHp: npc.maxHp,
        description: def?.description,
        art: def?.art,
      };
    });
  }

  /** Send combat_update with current combatant state */
  private sendCombatUpdate(session: CharacterSession): void {
    const combatants = this.buildCombatantInfo(session);
    if (combatants.length === 0) return;
    session.send(
      encodeMessage({
        type: "combat_update",
        combatants,
        targetId: session.combatTarget ?? combatants[0].id,
      }),
    );
  }
}
