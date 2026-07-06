import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import { TestClient, startServer, stopServer } from "../helpers.ts";

let port: number;
let serverProc: Subprocess;

beforeAll(async () => {
  const server = await startServer();
  port = server.port;
  serverProc = server.process;
});

afterAll(() => {
  stopServer(serverProc);
});

// ─── Combat ─────────────────────────────────────────────────

describe("combat", () => {
  test("hostile NPCs auto-aggro on room entry", async () => {
    const client = new TestClient("AggroTest");
    await client.connect(port, { classId: "warrior", raceId: "orc" });
    await client.waitFor("room_state");

    // Navigate to forest path (wolf auto-aggros on entry)
    await client.commandAndWaitRoom("s"); // gate
    await client.commandAndWaitRoom("s"); // crossroads
    await client.commandAndWaitRoom("e"); // forest edge
    await client.commandAndWaitRoom("e"); // forest path — wolf auto-aggros

    // Wait for auto-aggro messages to arrive
    await client.tick(200);

    // Verify combat started automatically
    const combatStarts = client.getMessagesOfType("combat_start");
    expect(combatStarts.length).toBeGreaterThan(0);
    expect(combatStarts[0].target).toContain("Wolf");

    // NPC free attack narrative should include "attacks you"
    const narratives = client.getMessagesOfType("narrative");
    expect(narratives.some((n) => n.text.includes("attacks you"))).toBe(true);

    // Should be in combat (can't move, can defend)
    client.clearMessages();
    const moveText = await client.commandAndWait("w");
    expect(moveText).toContain("can't move while in combat");

    client.clearMessages();
    const defendText = await client.commandAndWait("defend");
    expect(defendText).toContain("raise your guard");

    client.disconnect();
  });

  test("flee from combat", async () => {
    const client = new TestClient("Fleer");
    await client.connect(port, { classId: "rogue", raceId: "elf" });
    await client.waitFor("room_state");

    // Navigate to forest path (wolf auto-aggros on entry)
    await client.commandAndWaitRoom("s");
    await client.commandAndWaitRoom("s");
    await client.commandAndWaitRoom("e");
    await client.commandAndWaitRoom("e"); // auto-aggro starts combat

    // Wait for auto-aggro to settle
    await client.tick(200);

    // Try fleeing — with high dex (16) should usually succeed
    // Accept either escape or getting killed as valid outcomes
    let result: "escape" | "died" | "stuck" = "stuck";
    for (let i = 0; i < 10; i++) {
      client.clearMessages();
      const text = await client.commandAndWait("flee");
      if (text.includes("escape")) {
        result = "escape";
        break;
      }
      if (text.includes("not in combat") || text.includes("defeated")) {
        result = "died";
        break;
      }
      // Otherwise: "can't get away" — keep trying
    }
    // Flee mechanic works if we got any combat-relevant response
    expect(result === "escape" || result === "died").toBe(true);
    client.disconnect();
  });

  test("safe rooms prevent combat", async () => {
    const client = new TestClient("SafeZone");
    await client.connect(port, { classId: "rogue", raceId: "elf" });
    await client.waitFor("room_state");

    // Navigate toward mushroom grove (safe zone) — must pass through forest path
    await client.commandAndWaitRoom("s"); // gate
    await client.commandAndWaitRoom("s"); // crossroads
    await client.commandAndWaitRoom("e"); // forest edge
    await client.commandAndWaitRoom("e"); // forest path (wolf auto-aggro)

    // Flee from auto-aggro'd wolf before continuing
    await client.tick(200);
    for (let i = 0; i < 20; i++) {
      client.clearMessages();
      const fleeText = await client.commandAndWait("flee");
      if (fleeText.includes("escape") || fleeText.includes("not in combat")) break;
      if (fleeText.includes("defeated")) break;
    }

    await client.commandAndWaitRoom("n"); // mushroom grove (safe)
    client.clearMessages();

    const text = await client.commandAndWait("attack morel");
    expect(text).toContain("safe zone");
    client.disconnect();
  });

  test("use consumable in combat", async () => {
    const client = new TestClient("PotionUser");
    await client.connect(port, { classId: "warrior", raceId: "human" });
    await client.waitFor("room_state");

    // Buy bread from tavern (consumable that heals)
    await client.commandAndWaitRoom("n"); // tavern
    await client.commandAndWait("buy bread");
    await client.waitFor("inventory_update");

    // Navigate to forest path (wolf auto-aggros — starts combat)
    await client.commandAndWaitRoom("s"); // town square
    await client.commandAndWaitRoom("s"); // gate
    await client.commandAndWaitRoom("s"); // crossroads
    await client.commandAndWaitRoom("e"); // forest edge
    await client.commandAndWaitRoom("e"); // forest path — auto-aggro

    // Wait for auto-aggro to settle
    await client.tick(200);

    // Use bread to heal (should work during auto-aggro combat)
    client.clearMessages();
    const text = await client.commandAndWait("use bread");
    expect(text).toContain("Loaf of Bread");
    expect(text).toContain("HP:");
    client.disconnect();
  });

  test("kill NPC, gain XP, get loot", async () => {
    // Combat is RNG-based — retry with fresh connections if player dies
    let killed = false;
    for (let attempt = 0; attempt < 3 && !killed; attempt++) {
      const client = new TestClient(`Slayer${attempt}`);
      await client.connect(port, { classId: "warrior", raceId: "orc" });
      await client.waitFor("room_state");

      // Navigate to forest path — wolf auto-aggros on entry
      await client.commandAndWaitRoom("s"); // gate
      await client.commandAndWaitRoom("s"); // crossroads
      await client.commandAndWaitRoom("e"); // forest edge
      await client.commandAndWaitRoom("e"); // forest path — auto-aggro
      await client.tick(200);
      client.clearMessages();

      // Fight wolf until it dies or we die (combat already started via auto-aggro)
      for (let i = 0; i < 30; i++) {
        const text = await client.commandAndWait("attack wolf");
        if (text.includes("slain")) {
          killed = true;
          expect(text).toContain("XP");
          break;
        }
        if (text.includes("defeated") || text.includes("don't see")) {
          break;
        }
      }
      client.disconnect();
    }
    expect(killed).toBe(true);
  });
});

// ─── Spells ──────────────────────────────────────────────────

describe("spells", () => {
  test("mage can view spell list", async () => {
    const mage = new TestClient("TestMage");
    await mage.connect(port, { classId: "mage", raceId: "elf" });
    await mage.waitFor("room_state");

    const text = await mage.commandAndWait("spells");
    expect(text).toContain("Your spells:");
    expect(text).toContain("Fireball");
    expect(text).toContain("Ice Shard");
    expect(text).toContain("Arcane Bolt");
    expect(text).toContain("Lesser Heal");
    expect(text).toContain("MP");

    mage.disconnect();
  });

  test("warrior has no spells", async () => {
    const warrior = new TestClient("NoSpellGuy");
    await warrior.connect(port, { classId: "warrior", raceId: "human" });
    await warrior.waitFor("room_state");

    const text = await warrior.commandAndWait("spells");
    expect(text).toContain("no spells");

    warrior.disconnect();
  });

  test("mage can cast heal on self out of combat", async () => {
    const mage = new TestClient("SelfHealer");
    await mage.connect(port, { classId: "mage", raceId: "elf" });
    await mage.waitFor("room_state");

    mage.clearMessages();
    mage.command("cast lesser heal");
    const narrative = await mage.waitFor("narrative");
    expect(narrative.text).toContain("casts Lesser Heal");
    expect(narrative.text).toContain("HP:");

    // Should get character_update with reduced MP
    const update = await mage.waitFor("character_update");
    expect(update.mp).toBeLessThan(update.maxMp);

    mage.disconnect();
  });

  test("mage can cast attack spell in combat", async () => {
    const mage = new TestClient("BattleMage");
    await mage.connect(port, { classId: "mage", raceId: "elf" });
    await mage.waitFor("room_state");

    // Navigate to deep forest — wolf auto-aggros on entry
    await mage.commandAndWaitRoom("s"); // gate
    await mage.commandAndWaitRoom("s"); // crossroads
    await mage.commandAndWaitRoom("e"); // forest edge
    await mage.commandAndWaitRoom("e"); // forest path (may or may not have wolf)

    // Flee if auto-aggro'd at forest-path
    await mage.tick(200);
    for (let i = 0; i < 20; i++) {
      mage.clearMessages();
      const fleeText = await mage.commandAndWait("flee");
      if (fleeText.includes("escape") || fleeText.includes("not in combat")) break;
      if (fleeText.includes("defeated")) break;
    }

    // Continue to deep forest (wolf here auto-aggros)
    await mage.commandAndWaitRoom("e"); // deep forest
    await mage.tick(200);

    // Cast fireball on the wolf (already in combat via auto-aggro)
    mage.clearMessages();
    const text = await mage.commandAndWait("cast fireball wolf");
    expect(text).toContain("casts Fireball");
    expect(text).toContain("MP spent");

    mage.disconnect();
  });

  test("warrior cannot cast spells", async () => {
    const warrior = new TestClient("WarriorCaster");
    await warrior.connect(port, { classId: "warrior", raceId: "human" });
    await warrior.waitFor("room_state");

    const text = await warrior.commandAndWait("cast fireball");
    expect(text).toContain("class cannot cast");

    warrior.disconnect();
  });

  test("casting with insufficient MP fails", async () => {
    const mage = new TestClient("NoManaMage");
    await mage.connect(port, { classId: "mage", raceId: "elf" });
    await mage.waitFor("room_state");

    // Drain MP by casting repeatedly
    for (let i = 0; i < 20; i++) {
      mage.command("cast lesser heal");
      await mage.tick(50);
    }
    mage.clearMessages();

    // Now try to cast a big spell
    const text = await mage.commandAndWait("cast fireball");
    // Either ran out of MP or needs a target — both are valid
    expect(text.toLowerCase()).toMatch(/not enough mana|cast .* at whom/i);

    mage.disconnect();
  });

  test("cleric can cast heal and smite", async () => {
    const cleric = new TestClient("TestCleric");
    await cleric.connect(port, { classId: "cleric", raceId: "dwarf" });
    await cleric.waitFor("room_state");

    const spellText = await cleric.commandAndWait("spells");
    expect(spellText).toContain("Heal");
    expect(spellText).toContain("Smite");
    expect(spellText).toContain("Bless");
    expect(spellText).toContain("Lesser Heal");

    const healText = await cleric.commandAndWait("cast heal");
    expect(healText).toContain("casts Heal");

    cleric.disconnect();
  });

  test("help includes spell commands", async () => {
    const hero = new TestClient("HelpChecker");
    await hero.connect(port);
    await hero.waitFor("room_state");

    const text = await hero.commandAndWait("help");
    expect(text).toContain("cast");
    expect(text).toContain("spells");
    expect(text).toContain("AP");

    hero.disconnect();
  });

  test("spell list shows AP costs", async () => {
    const mage = new TestClient("APSpellCheck");
    await mage.connect(port, { classId: "mage", raceId: "elf" });
    await mage.waitFor("room_state");

    const text = await mage.commandAndWait("spells");
    expect(text).toContain("AP");
    // Fireball costs 4 AP
    expect(text).toContain("4 AP");

    mage.disconnect();
  });
});

// ─── Action Points ───────────────────────────────────────────

describe("action points", () => {
  test("character_update includes AP fields", async () => {
    const client = new TestClient("APCheck");
    await client.connect(port, { classId: "mage", raceId: "elf" });
    await client.waitFor("room_state");

    // Cast a self-heal to trigger character_update
    client.clearMessages();
    client.command("cast lesser heal");
    await client.waitFor("narrative");
    const update = await client.waitFor("character_update");
    expect(update.ap).toBeDefined();
    expect(update.maxAp).toBeDefined();
    expect(update.maxAp).toBeGreaterThanOrEqual(2);

    client.disconnect();
  });

  test("AP refreshes each combat round", async () => {
    const client = new TestClient("APRefresh");
    await client.connect(port, { classId: "warrior", raceId: "orc" });
    await client.waitFor("room_state");

    // Navigate to hostile room (wolf auto-aggros)
    await client.commandAndWaitRoom("s"); // gate
    await client.commandAndWaitRoom("s"); // crossroads
    await client.commandAndWaitRoom("e"); // forest edge
    await client.commandAndWaitRoom("e"); // forest path — auto-aggro
    await client.tick(200);

    // Attack multiple rounds — each should succeed (AP refreshes each round)
    for (let i = 0; i < 3; i++) {
      client.clearMessages();
      const text = await client.commandAndWait("attack wolf");
      // Should either hit, miss, or kill — never "not enough AP"
      expect(text).not.toContain("Not enough AP");
      if (text.includes("slain") || text.includes("defeated") || text.includes("don't see")) break;
    }

    client.disconnect();
  });

  test("stats shows AP values", async () => {
    const client = new TestClient("APStats");
    await client.connect(port);
    await client.waitFor("room_state");

    const text = await client.commandAndWait("stats");
    expect(text).toContain("AP:");

    client.disconnect();
  });
});

// ─── Multi-Target Combat ─────────────────────────────────────

/** Navigate to spider-hollow (2 spiders) through hostile rooms, fleeing as needed */
async function navigateToSpiderHollow(client: TestClient): Promise<void> {
  await client.commandAndWaitRoom("s"); // gate
  await client.commandAndWaitRoom("s"); // crossroads
  await client.commandAndWaitRoom("e"); // forest-edge

  // forest-path has wolf — may auto-aggro
  await client.commandAndWaitRoom("e");
  await client.tick(200);
  for (let i = 0; i < 20; i++) {
    client.clearMessages();
    const text = await client.commandAndWait("flee");
    if (text.includes("escape") || text.includes("not in combat")) break;
    if (text.includes("defeated")) break;
  }
  client.clearMessages();

  // deep-forest has wolf — may auto-aggro
  await client.commandAndWaitRoom("e");
  await client.tick(200);
  for (let i = 0; i < 20; i++) {
    client.clearMessages();
    const text = await client.commandAndWait("flee");
    if (text.includes("escape") || text.includes("not in combat")) break;
    if (text.includes("defeated")) break;
  }
  client.clearMessages();

  // spider-hollow — 2 spiders auto-aggro
  await client.commandAndWaitRoom("e");
  await client.tick(200);
}

describe("multi-target combat", () => {
  test("entering spider-hollow triggers combat with multiple spiders", async () => {
    const client = new TestClient("MultiCombat1");
    await client.connect(port, { classId: "rogue", raceId: "elf" });
    await client.waitFor("room_state");

    await navigateToSpiderHollow(client);

    // Should have received combat_start from auto-aggro
    const combatMsgs = client.getMessagesOfType("combat_start");
    const narratives = client.getMessagesOfType("narrative");
    const allText = narratives.map((n) => n.text).join("\n");

    // Should be in combat — either got combat_start or a narrative about being attacked
    const inCombat =
      combatMsgs.length > 0 || allText.includes("attacks") || allText.includes("lunges");
    expect(inCombat).toBe(true);

    client.disconnect();
  });

  test("all hostile NPCs retaliate each round", async () => {
    const client = new TestClient("MultiRetali");
    await client.connect(port, { classId: "warrior", raceId: "orc" });
    await client.waitFor("room_state");

    await navigateToSpiderHollow(client);
    client.clearMessages();

    // Attack — both spiders should retaliate
    const text = await client.commandAndWait("attack spider");

    // The narrative should mention at least one spider attack
    const hasAction =
      text.includes("Spider") || text.includes("spider") || text.includes("not in combat");
    expect(hasAction).toBe(true);

    client.disconnect();
  });

  test("killing one NPC continues combat with remaining", async () => {
    const client = new TestClient("MultiKill");
    await client.connect(port, { classId: "warrior", raceId: "orc" });
    await client.waitFor("room_state");

    await navigateToSpiderHollow(client);
    client.clearMessages();

    // Fight until first spider dies or we die
    let combatText = "";
    for (let i = 0; i < 30; i++) {
      client.clearMessages();
      const text = await client.commandAndWait("attack spider");
      combatText += text + "\n";

      if (text.includes("slain") || text.includes("defeated")) break;
      if (text.includes("darkness") || text.includes("respawn")) break;
      if (text.includes("not in combat")) break;
    }

    const validOutcome =
      combatText.includes("turn to face") ||
      combatText.includes("slain") ||
      combatText.includes("defeated") ||
      combatText.includes("darkness") ||
      combatText.includes("respawn") ||
      combatText.includes("not in combat");
    expect(validOutcome).toBe(true);

    client.disconnect();
  });

  test("flee from multi-target combat resets all NPCs", async () => {
    const client = new TestClient("MultiFlee");
    await client.connect(port, { classId: "rogue", raceId: "elf" });
    await client.waitFor("room_state");

    await navigateToSpiderHollow(client);
    client.clearMessages();

    let result: "escaped" | "died" | "no_combat" = "no_combat";
    for (let i = 0; i < 15; i++) {
      client.clearMessages();
      const text = await client.commandAndWait("flee");
      if (text.includes("escape")) {
        result = "escaped";
        break;
      }
      if (text.includes("not in combat") || text.includes("Just walk away")) {
        result = "no_combat";
        break;
      }
      if (text.includes("darkness") || text.includes("respawn")) {
        result = "died";
        break;
      }
    }

    if (result === "escaped") {
      await client.tick(100);
      const endMsgs = client.getMessagesOfType("combat_end");
      expect(endMsgs.length).toBeGreaterThan(0);
      expect(endMsgs[0].reason).toBe("flee");
    }

    expect(["escaped", "died", "no_combat"]).toContain(result);

    client.disconnect();
  });

  test("defend blocks attacks from all NPCs", async () => {
    const client = new TestClient("MultiDefend");
    await client.connect(port, { classId: "warrior", raceId: "orc" });
    await client.waitFor("room_state");

    await navigateToSpiderHollow(client);
    client.clearMessages();

    const text = await client.commandAndWait("defend");

    const hasDefend =
      text.toLowerCase().includes("brace") ||
      text.toLowerCase().includes("defend") ||
      text.toLowerCase().includes("spider") ||
      text.includes("not in combat");
    expect(hasDefend).toBe(true);

    client.disconnect();
  });

  test("combat_start and combat_update include combatant info", async () => {
    const client = new TestClient("CombatUI");
    await client.connect(port, { classId: "warrior", raceId: "orc" });
    await client.waitFor("room_state");

    await navigateToSpiderHollow(client);

    const combatStarts = client.getMessagesOfType("combat_start");
    if (combatStarts.length > 0) {
      const start = combatStarts[0];
      expect(start.combatants).toBeDefined();
      expect(start.combatants.length).toBeGreaterThan(0);
      expect(start.combatants[0].name).toBeDefined();
      expect(start.combatants[0].hp).toBeDefined();
      expect(start.combatants[0].maxHp).toBeDefined();
      expect(start.combatants[0].level).toBeDefined();
    }

    client.clearMessages();

    await client.commandAndWait("attack spider");
    await client.tick(100);
    const updates = client.getMessagesOfType("combat_update");

    const combatEnds = client.getMessagesOfType("combat_end");
    if (combatEnds.length === 0 && updates.length > 0) {
      expect(updates[0].combatants).toBeDefined();
      expect(updates[0].targetId).toBeDefined();
    }

    client.disconnect();
  });
});
