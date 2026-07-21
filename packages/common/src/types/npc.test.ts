import { describe, expect, test } from "bun:test";
import { createNpcInstance, computeNpcMaxHp } from "./npc.ts";
import { resolveNpcAttack, resolvePlayerAttack } from "../engine/combat-engine.ts";
import type { NpcDefinition, AttributeDef, Attributes } from "@realms/lexicons";

// A system whose attribute defaults are deliberately NOT 10, so tests prove
// NPCs inherit the configured defaults instead of the old hardcoded 10.
const attributeDefs: Record<string, AttributeDef> = {
  str: { name: "Strength", description: "", defaultValue: 12 },
  dex: { name: "Dexterity", description: "", defaultValue: 14 },
  con: { name: "Constitution", description: "", defaultValue: 16 },
};

function makeDef(overrides: Partial<NpcDefinition> = {}): NpcDefinition {
  return {
    name: "Goblin",
    description: "A snarling goblin.",
    behavior: "hostile",
    ...overrides,
  } as NpcDefinition;
}

describe("createNpcInstance attributes", () => {
  test("fills every attribute from system defaults when the definition omits them", () => {
    const npc = createNpcInstance("goblin", makeDef(), "room1", attributeDefs);
    expect(npc.attributes).toEqual({ str: 12, dex: 14, con: 16 });
  });

  test("definition attributes override system defaults; the rest are still filled", () => {
    const npc = createNpcInstance(
      "goblin",
      makeDef({ attributes: { dex: 8 } }),
      "room1",
      attributeDefs,
    );
    expect(npc.attributes).toEqual({ str: 12, dex: 8, con: 16 });
  });

  test("uses only the definition's own attributes when the system declares none", () => {
    const npc = createNpcInstance("goblin", makeDef({ attributes: { con: 11 } }), "room1", {});
    expect(npc.attributes).toEqual({ con: 11 });
  });

  test("maxHp reflects the system constitution default, not a hardcoded 10", () => {
    // con default 16 -> conMod floor((16-10)/2) = 3
    const npc = createNpcInstance("goblin", makeDef({ level: 2 }), "room1", attributeDefs);
    // computeNpcMaxHp: 10 + 2*5 + max(0, 3) = 23
    expect(npc.maxHp).toBe(23);
    expect(npc.currentHp).toBe(23);
    // A con default of 10 would have produced 20 — prove the default flowed through.
    expect(npc.maxHp).not.toBe(20);
  });
});

describe("createNpcInstance in combat math", () => {
  test("NPC attack bonus uses the system dex default", () => {
    const npc = createNpcInstance("goblin", makeDef({ level: 4 }), "room1", attributeDefs);
    const playerAttrs: Attributes = { str: 10, dex: 10, con: 10 };
    const result = resolveNpcAttack(npc.attributes, npc.level, npc.name, playerAttrs, {});
    // dex default 14 -> dexMod 2; level 4 -> +floor(4/2)=2; total 4
    expect(result.attackBonus).toBe(4);
  });

  test("player attack sees the NPC's system-default dex as defense", () => {
    const npc = createNpcInstance("goblin", makeDef(), "room1", attributeDefs);
    const playerAttrs: Attributes = { str: 10, dex: 10, con: 10 };
    const result = resolvePlayerAttack(playerAttrs, {}, npc.attributes, npc.level);
    // NPC dex default 14 -> dexMod 2 -> defense 10 + 2 = 12
    expect(result.defense).toBe(12);
  });
});

describe("computeNpcMaxHp", () => {
  test("derives the constitution modifier from the provided attributes", () => {
    expect(computeNpcMaxHp(1, { con: 10 })).toBe(15); // 10 + 5 + 0
    expect(computeNpcMaxHp(1, { con: 16 })).toBe(18); // 10 + 5 + 3
  });
});

describe("createNpcInstance attackCooldown", () => {
  test("defaults attackCooldown to 1 and seeds the swing counter", () => {
    const npc = createNpcInstance("area:goblin", makeDef(), "area:spawn", attributeDefs);
    expect(npc.attackCooldown).toBe(1);
    expect(npc.ticksUntilSwing).toBe(1);
  });

  test("carries an explicit attackCooldown and seeds the counter to match", () => {
    const npc = createNpcInstance(
      "area:tiger",
      makeDef({ name: "Tiger", attackCooldown: 3 }),
      "area:spawn",
      attributeDefs,
    );
    expect(npc.attackCooldown).toBe(3);
    expect(npc.ticksUntilSwing).toBe(3);
  });
});
