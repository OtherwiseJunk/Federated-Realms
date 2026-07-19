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
  session.refreshAp();

  const npcManager = {
    getAllInRoom: () => npcs,
    getInstance: (id: string) => npcs.find((n) => n.instanceId === id),
    getDefinition: () => undefined,
  };

  const world = { npcManager } as unknown as WorldManager;
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
