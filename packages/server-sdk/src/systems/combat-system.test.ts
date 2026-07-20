import { describe, expect, test } from "bun:test";
import { CombatSystem, type CombatContext } from "./combat-system.js";
import { CharacterSession } from "../entities/character-session.js";
import type { CharacterProfile, FormulaDef } from "@realms/lexicons";
import type { NpcInstance } from "@realms/common";
import type { WorldManager } from "../world/world-manager.js";
import type { SessionManager } from "../server/session-manager.js";

const FORMULAS: Record<string, FormulaDef> = {
  maxHp: { name: "Max HP", expression: "20 + (level - 1) * 8 + floor(con / 2)", min: 1 },
  maxMp: { name: "Max MP", expression: "10 + (level - 1) * 4 + floor(int / 3)", min: 0 },
  maxAp: { name: "Max AP", expression: "4 + floor((dex - 10) / 4)", min: 2, max: 12 },
};

function makeProfile(): CharacterProfile {
  return {
    name: "TestHero",
    class: "warrior",
    race: "human",
    level: 1,
    experience: 0,
    attributes: { str: 14, dex: 12, con: 13, int: 10, wis: 10, cha: 12 },
    createdAt: new Date().toISOString(),
  };
}

function makeNpc(overrides: Partial<NpcInstance> = {}): NpcInstance {
  return {
    instanceId: "npc-1",
    definitionId: "area:goblin",
    name: "Goblin",
    behavior: "hostile",
    state: "combat",
    level: 1,
    currentRoom: "test-area:spawn",
    attributes: { str: 10, dex: 10 },
    currentHp: 20,
    maxHp: 20,
    attackCooldown: 1,
    ticksUntilSwing: 1,
    ...overrides,
  };
}

/** Build a CombatSystem whose world reports the given NPCs as in-room combatants. */
function makeCombatSystem(npcs: NpcInstance[]): {
  combat: CombatSystem;
  session: CharacterSession;
} {
  const session = new CharacterSession(
    "session-1",
    "did:plc:test",
    makeProfile(),
    "test-area:spawn",
    FORMULAS,
  );
  session.combatTarget = npcs[0]?.instanceId ?? null;
  session.state.currentAp = session.state.maxAp;

  const npcManager = {
    getAllInRoom: () => npcs,
    getInstance: (id: string) => npcs.find((n) => n.instanceId === id),
    getDefinition: () => undefined,
    damageNpc: () => false,
    findInRoom: (_r: string, name: string) =>
      npcs.find((n) => n.name.toLowerCase().includes(name.toLowerCase())),
  };

  const gameSystem = {
    spells: {
      firebolt: {
        name: "Firebolt",
        mpCost: 2,
        apCost: 2,
        target: "enemy",
        effect: "damage",
        power: 1,
      },
    },
    classes: {
      warrior: { spells: ["firebolt"] },
    },
  };

  const world = {
    npcManager,
    gameSystem,
    getRoom: () => ({
      id: "test-area:spawn",
      isSafe: () => false,
      addGroundItem: () => {},
    }),
  } as unknown as WorldManager;
  const sessions = {} as unknown as SessionManager;
  const ctx: CombatContext = { world, sessions, broadcast: () => {} };

  return { combat: new CombatSystem(ctx), session };
}

describe("CombatSystem defend", () => {
  test("does not mutate player attributes after resolving", () => {
    const { combat, session } = makeCombatSystem([makeNpc()]);
    const attrsBefore = { ...session.state.attributes };

    combat.defend(session);

    expect(session.state.attributes).toEqual(attrsBefore);
    expect(session.state.attributes.dex).toBe(12);
    expect(session.isDefending).toBe(false);
  });

  test("leaves attributes intact even if an NPC attack throws mid-round", () => {
    const goodNpc = makeNpc();
    // A malformed NPC whose level access throws forces an exception between the
    // (former) mutate and restore. With the fix there is nothing to restore.
    const badNpc = makeNpc({ instanceId: "npc-2" });
    Object.defineProperty(badNpc, "level", {
      get() {
        throw new Error("boom");
      },
    });

    const { combat, session } = makeCombatSystem([goodNpc, badNpc]);
    const dexBefore = session.state.attributes.dex;
    session.isDefending = true;

    expect(() => {
      (combat as unknown as { allNpcsRetaliate: (s: CharacterSession) => void }).allNpcsRetaliate(
        session,
      );
    }).toThrow();

    expect(session.state.attributes.dex).toBe(dexBefore);
  });
});

describe("AP economy (issue #24)", () => {
  test("attacks drain AP and are refused when the pool is empty", () => {
    // maxAp with dex 12 = 4 + floor(2/4) = 4; attack costs 2.
    const npc = makeNpc({ currentHp: 500, maxHp: 500 });
    const { combat, session } = makeCombatSystem([npc]);
    session.state.currentAp = session.state.maxAp; // 4

    combat.attack(session); // 4 -> 2
    expect(session.state.currentAp).toBe(2);
    combat.attack(session); // 2 -> 0
    expect(session.state.currentAp).toBe(0);

    const hpBefore = npc.currentHp;
    combat.attack(session); // refused — no AP
    expect(session.state.currentAp).toBe(0);
    expect(npc.currentHp).toBe(hpBefore);
  });

  test("a combat-opening spell charges AP like an opening attack", () => {
    // Covers the #85 divergence: castSpell previously charged only if already in combat.
    const npc = makeNpc({ currentHp: 500, maxHp: 500 });
    const { combat, session } = makeCombatSystem([npc]);
    session.combatTarget = null; // out of combat
    npc.state = "idle";
    session.state.currentAp = session.state.maxAp;
    session.state.currentMp = 99;

    combat.castSpell(session, "firebolt", "Goblin");
    expect(session.state.currentAp).toBe(session.state.maxAp - 2);
  });
});
