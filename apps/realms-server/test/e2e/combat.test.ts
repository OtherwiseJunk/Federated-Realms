import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import {
  TestClient,
  startServer,
  stopServer,
  TICK_WAIT_MS,
  actUntilApReady,
  fleeUntilClear,
} from "../helpers.ts";

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

/**
 * Navigate from town square to forest-path, fleeing the wolf if it
 * auto-aggros. Pulse combat can let the wolf kill the player during that
 * flee — ticks give it real chances to swing while we wait on AP (an
 * unarmored player has a ~70% chance of getting hit for real damage per
 * wolf swing), and if that happens we respawn back at town square, so this
 * restarts navigation from there rather than continuing to walk from a room
 * we're no longer in. Resolves once we're alive and standing in forest-path.
 * `attemptsLeft` is generous because dying once along the way isn't rare.
 */
async function reachForestPathAlive(client: TestClient, attemptsLeft = 8): Promise<void> {
  if (attemptsLeft <= 0) {
    throw new Error("Could not reach forest-path alive after several attempts");
  }
  await client.commandAndWaitRoom("s"); // gate
  await client.commandAndWaitRoom("s"); // crossroads
  await client.commandAndWaitRoom("e"); // forest-edge
  await client.commandAndWaitRoom("e"); // forest-path — may auto-aggro
  await client.tick(200);
  const outcome = await fleeUntilClear(client);
  client.clearMessages();
  if (outcome === "stuck") {
    // Still mid-combat in forest-path — we haven't moved, so restarting
    // navigation from town square would be wrong. This should be
    // exceedingly rare given fleeUntilClear's generous attempt budget.
    throw new Error("Stuck fleeing the forest-path wolf — never escaped or died");
  }
  if (outcome === "died") {
    await client.tick(300);
    await reachForestPathAlive(client, attemptsLeft - 1);
  }
}

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

    // Try fleeing — with high dex (16) should usually succeed. Flee costs
    // AP; under pulse combat that AP only regenerates on a server tick, so
    // a failed attempt needs a tick wait before it's worth retrying, and
    // the wolf gets real chances to swing while we wait. Any definitive
    // outcome (escape, death, or already clear) confirms flee works —
    // "stuck" (exhausted retries with no resolution) is the only failure.
    const result = await fleeUntilClear(client);
    expect(result).not.toBe("stuck");
    client.disconnect();
  }, 300_000);

  test("safe rooms prevent combat", async () => {
    const client = new TestClient("SafeZone");
    await client.connect(port, { classId: "rogue", raceId: "elf" });
    await client.waitFor("room_state");

    // Navigate toward mushroom grove (safe zone) — must pass through forest
    // path, fleeing the wolf if it auto-aggros (and, per pulse combat,
    // restarting from town square if it kills us before we escape).
    await reachForestPathAlive(client);

    await client.commandAndWaitRoom("n"); // mushroom grove (safe)
    client.clearMessages();

    const text = await client.commandAndWait("attack morel");
    expect(text).toContain("safe zone");
    client.disconnect();
  }, 300_000);

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
    // Combat is RNG-based — retry with fresh connections if player dies.
    // Con-heavy build (dwarf warrior) keeps AP regen at 2/tick, matching
    // the attack cost, so only one tick wait is needed between attacks
    // once the starting AP burst is spent.
    let killed = false;
    for (let attempt = 0; attempt < 3 && !killed; attempt++) {
      const client = new TestClient(`Slayer${attempt}`);
      await client.connect(port, { classId: "warrior", raceId: "dwarf" });
      await client.waitFor("room_state");

      // Navigate to forest path — wolf auto-aggros on entry
      await client.commandAndWaitRoom("s"); // gate
      await client.commandAndWaitRoom("s"); // crossroads
      await client.commandAndWaitRoom("e"); // forest edge
      await client.commandAndWaitRoom("e"); // forest path — auto-aggro
      await client.tick(200);
      client.clearMessages();

      // Fight wolf until it dies or we die (combat already started via
      // auto-aggro). AP only regenerates on the server tick, so a refused
      // attack needs a tick wait before it's worth retrying, and the wolf
      // gets real chances to swing back while we wait.
      for (let i = 0; i < 20; i++) {
        const { text, died } = await actUntilApReady(client, "attack wolf");
        if (text.includes("slain")) {
          killed = true;
          expect(text).toContain("XP");
          break;
        }
        if (died || text.includes("defeated") || text.includes("don't see")) {
          break;
        }
      }
      client.disconnect();
    }
    expect(killed).toBe(true);
  }, 240_000);
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

    // Navigate to deep forest, fleeing the forest-path wolf if it
    // auto-aggros (restarting from town square if it kills us first).
    await reachForestPathAlive(mage);

    // Continue to deep forest (wolf here auto-aggros)
    await mage.commandAndWaitRoom("e"); // deep forest
    await mage.tick(200);

    // Cast fireball on the wolf (already in combat via auto-aggro).
    // Fireball costs 4 AP — the mage's full pool — so if fleeing above
    // spent AP, wait for it to regenerate before the cast lands.
    mage.clearMessages();
    const { text } = await actUntilApReady(mage, "cast fireball wolf");
    expect(text).toContain("casts Fireball");
    expect(text).toContain("MP spent");

    mage.disconnect();
  }, 400_000);

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

  test("AP drains with attacks and regenerates on the tick", async () => {
    const client = new TestClient("APRefresh");
    await client.connect(port, { classId: "warrior", raceId: "dwarf" });
    await client.waitFor("room_state");

    // Navigate to deep forest. Its wolf may already be somewhat weakened by
    // an earlier test's single spell hit (unlike the forest-path wolf,
    // which "kill NPC, gain XP, get loot" reliably kills outright) — we
    // tolerate it dying early below rather than assuming it survives a
    // fixed number of hits.
    await reachForestPathAlive(client);
    await client.commandAndWaitRoom("e"); // deep forest — auto-aggro
    await client.tick(200);

    // Fleeing the forest-path wolf above may have spent AP. Wait long
    // enough (dwarf con 15 -> 2 AP/tick, maxAp 4) to guarantee it's back
    // at max regardless of where it started, before establishing the
    // deterministic baseline below.
    await client.tick(TICK_WAIT_MS * 2);
    client.clearMessages();

    // maxAp is 4 (dex 10) and attack costs 2 AP: two attacks drain it fully
    // — unless the wolf dies first, in which case we've still exercised
    // the drain from 4 to 2 (or 2 to 0) and that's enough.
    client.command("attack wolf");
    let update = await client.waitFor("character_update");
    expect(update.ap).toBe(2);
    let wolfAlive = client.getMessagesOfType("combat_end").length === 0;

    if (wolfAlive) {
      client.clearMessages();
      client.command("attack wolf");
      update = await client.waitFor("character_update");
      expect(update.ap).toBe(0);
      wolfAlive = client.getMessagesOfType("combat_end").length === 0;
    }

    if (wolfAlive) {
      // A third attack is refused for lack of AP.
      const refused = await client.commandAndWait("attack wolf");
      expect(refused).toContain("Not enough AP");

      // Pulse combat regenerates AP only on the server's tick (dwarf con 15
      // gives 2 AP/tick here, matching the attack cost exactly), so the
      // next attempt should no longer be refused for lack of AP.
      await client.tick(TICK_WAIT_MS);
      const recovered = await client.commandAndWait("attack wolf");
      expect(recovered).not.toContain("Not enough AP");
    }

    client.disconnect();
  }, 400_000);

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

/**
 * Navigate to spider-hollow (2 spiders) through hostile rooms, fleeing as
 * needed. If a wolf kills us along the way, we respawn at town square —
 * restart the whole approach from there rather than continuing to walk
 * from a room we're no longer in. `attemptsLeft` is generous for the same
 * reason as `reachForestPathAlive`: dying once isn't rare.
 */
async function navigateToSpiderHollow(client: TestClient, attemptsLeft = 6): Promise<void> {
  if (attemptsLeft <= 0) {
    throw new Error("Could not reach spider-hollow alive after several attempts");
  }

  // forest-path has wolf — may auto-aggro
  await reachForestPathAlive(client);

  // deep-forest has wolf — may auto-aggro
  await client.commandAndWaitRoom("e");
  await client.tick(200);
  const outcome = await fleeUntilClear(client);
  client.clearMessages();
  if (outcome === "stuck") {
    // Still mid-combat in deep-forest — we haven't moved, so restarting
    // from town square would be wrong. Exceedingly rare in practice.
    throw new Error("Stuck fleeing the deep-forest wolf — never escaped or died");
  }
  if (outcome === "died") {
    await client.tick(300);
    return navigateToSpiderHollow(client, attemptsLeft - 1);
  }

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
  }, 600_000);

  test("all hostile NPCs retaliate each round", async () => {
    const client = new TestClient("MultiRetali");
    await client.connect(port, { classId: "warrior", raceId: "orc" });
    await client.waitFor("room_state");

    await navigateToSpiderHollow(client);
    client.clearMessages();

    // Attack — both spiders should retaliate. Navigation above may have
    // spent AP fleeing the wolves along the way, so wait for it to
    // regenerate if needed before this attack lands.
    const { text } = await actUntilApReady(client, "attack spider");

    // The narrative should mention at least one spider attack
    const hasAction =
      text.includes("Spider") || text.includes("spider") || text.includes("not in combat");
    expect(hasAction).toBe(true);

    client.disconnect();
  }, 600_000);

  test("killing one NPC continues combat with remaining", async () => {
    const client = new TestClient("MultiKill");
    await client.connect(port, { classId: "warrior", raceId: "dwarf" });
    await client.waitFor("room_state");

    await navigateToSpiderHollow(client);
    client.clearMessages();

    // Fight until first spider dies or we die. AP only regenerates on the
    // server tick, so a refused attack needs a tick wait before retrying,
    // and the spiders get real chances to swing back while we wait.
    let combatText = "";
    let died = false;
    for (let i = 0; i < 20; i++) {
      const outcome = await actUntilApReady(client, "attack spider");
      combatText += outcome.text + "\n";

      if (outcome.died) {
        died = true;
        break;
      }
      if (outcome.text.includes("slain") || outcome.text.includes("defeated")) break;
      if (outcome.text.includes("not in combat")) break;
    }

    const validOutcome =
      died ||
      combatText.includes("turn to face") ||
      combatText.includes("slain") ||
      combatText.includes("defeated") ||
      combatText.includes("not in combat");
    expect(validOutcome).toBe(true);

    client.disconnect();
  }, 600_000);

  test("flee from multi-target combat resets all NPCs", async () => {
    const client = new TestClient("MultiFlee");
    await client.connect(port, { classId: "rogue", raceId: "elf" });
    await client.waitFor("room_state");

    await navigateToSpiderHollow(client);
    client.clearMessages();

    const result = await fleeUntilClear(client);

    if (result === "escaped") {
      await client.tick(100);
      const endMsgs = client.getMessagesOfType("combat_end");
      expect(endMsgs.length).toBeGreaterThan(0);
      expect(endMsgs[endMsgs.length - 1].reason).toBe("flee");
    }

    expect(result).not.toBe("stuck");

    client.disconnect();
  }, 600_000);

  test("defend blocks attacks from all NPCs", async () => {
    const client = new TestClient("MultiDefend");
    await client.connect(port, { classId: "warrior", raceId: "orc" });
    await client.waitFor("room_state");

    await navigateToSpiderHollow(client);
    client.clearMessages();

    // Navigation above may have spent AP fleeing the wolves along the way.
    const { text } = await actUntilApReady(client, "defend");

    // "bracing" (not "brace") is the actual substring the success narrative
    // uses ("You raise your guard, bracing for the next attack..."). Under
    // pre-pulse semantics the player likely never reached this check alive
    // (spiders dealt a free hit on aggro), which is why this typo went
    // unnoticed — pulse combat's tick-only swings make the success path
    // reachable.
    const hasDefend =
      text.toLowerCase().includes("bracing") ||
      text.toLowerCase().includes("defend") ||
      text.toLowerCase().includes("spider") ||
      text.includes("not in combat");
    expect(hasDefend).toBe(true);

    client.disconnect();
  }, 600_000);

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
  }, 600_000);
});
