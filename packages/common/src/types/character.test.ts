import { describe, expect, test } from "bun:test";
import {
  evaluateFormula,
  computeDerivedStats,
  buildAttributes,
  profileToState,
  withDefaultFormulas,
} from "./character.ts";
import type { GameSystem } from "./character.ts";
import type { CharacterProfile, FormulaDef } from "@realms/lexicons";

describe("evaluateFormula", () => {
  test("evaluates simple arithmetic", () => {
    expect(evaluateFormula("2 + 3", {})).toBe(5);
    expect(evaluateFormula("10 - 4", {})).toBe(6);
    expect(evaluateFormula("3 * 4", {})).toBe(12);
    expect(evaluateFormula("10 / 3", {})).toBe(3); // floored
  });

  test("substitutes variables", () => {
    expect(evaluateFormula("str + 10", { str: 14 })).toBe(24);
    expect(evaluateFormula("level * 5", { level: 3 })).toBe(15);
  });

  test("handles multiple variables", () => {
    expect(evaluateFormula("str + con + level", { str: 14, con: 12, level: 3 })).toBe(29);
  });

  test("supports math functions", () => {
    expect(evaluateFormula("floor(7.8)", {})).toBe(7);
    expect(evaluateFormula("ceil(7.2)", {})).toBe(8);
    expect(evaluateFormula("max(5, 10)", {})).toBe(10);
    expect(evaluateFormula("min(5, 10)", {})).toBe(5);
    expect(evaluateFormula("abs(-5)", {})).toBe(5);
  });

  test("handles complex expressions", () => {
    // Default HP formula from system.yml: con * 2 + level * 5
    expect(evaluateFormula("con * 2 + level * 5", { con: 13, level: 1 })).toBe(31);
  });

  test("handles parentheses", () => {
    expect(evaluateFormula("(str + con) * 2", { str: 10, con: 12 })).toBe(44);
  });

  test("returns 0 for invalid results", () => {
    expect(evaluateFormula("0 / 0", {})).toBe(0); // NaN -> 0
  });

  test("rejects dangerous expressions", () => {
    expect(() => evaluateFormula("process.exit()", {})).toThrow("Invalid formula");
    expect(() => evaluateFormula("globalThis", {})).toThrow("Invalid formula");
    expect(() => evaluateFormula("require('fs')", {})).toThrow("Invalid formula");
    expect(() => evaluateFormula("constructor", {})).toThrow("Invalid formula");
  });
});

describe("computeDerivedStats", () => {
  const formulas: Record<string, FormulaDef> = {
    maxHp: { name: "Max HP", expression: "con * 2 + level * 5", min: 1 },
    maxMp: { name: "Max MP", expression: "int * 2 + wis + level * 3", min: 0 },
    maxAp: { name: "Max AP", expression: "4 + floor(dex / 5)", min: 1 },
  };

  test("computes derived stats from formulas", () => {
    const derived = computeDerivedStats(formulas, 1, { con: 13, int: 10, wis: 10, dex: 10 });
    expect(derived.maxHp).toBe(31);
    expect(derived.maxMp).toBe(33);
    expect(derived.maxAp).toBe(6);
  });

  test("respects min constraints", () => {
    const derived = computeDerivedStats(
      { test: { name: "Test", expression: "str - 100", min: 1 } },
      1,
      { str: 10 },
    );
    expect(derived.test).toBe(1);
  });

  test("handles level scaling", () => {
    const level1 = computeDerivedStats(formulas, 1, { con: 10, int: 10, wis: 10, dex: 10 });
    const level5 = computeDerivedStats(formulas, 5, { con: 10, int: 10, wis: 10, dex: 10 });
    expect(level5.maxHp).toBeGreaterThan(level1.maxHp);
  });
});

describe("buildAttributes", () => {
  const system: GameSystem = {
    attributes: {
      str: { name: "Strength", description: "Physical power", defaultValue: 10 },
      dex: { name: "Dexterity", description: "Agility", defaultValue: 10 },
      con: { name: "Constitution", description: "Toughness", defaultValue: 10 },
    },
    classes: {
      warrior: {
        name: "Warrior",
        description: "A fighter",
        attributeBonuses: { str: 5, con: 3 },
      },
      mage: {
        name: "Mage",
        description: "A spellcaster",
        attributeBonuses: { str: -2 },
      },
    },
    races: {
      human: { name: "Human", description: "Versatile", attributeBonuses: { cha: 2 } },
      dwarf: { name: "Dwarf", description: "Hardy", attributeBonuses: { con: 2, dex: -1 } },
    },
    formulas: {},
  };

  test("starts with default attribute values", () => {
    const attrs = buildAttributes(system, "warrior", "human");
    expect(attrs.dex).toBe(10); // no bonuses
  });

  test("applies class bonuses", () => {
    const attrs = buildAttributes(system, "warrior", "human");
    expect(attrs.str).toBe(15); // 10 + 5
    expect(attrs.con).toBe(13); // 10 + 3
  });

  test("applies race bonuses", () => {
    const attrs = buildAttributes(system, "warrior", "dwarf");
    expect(attrs.con).toBe(15); // 10 + 3 (class) + 2 (race)
    expect(attrs.dex).toBe(9); // 10 - 1 (race)
  });

  test("handles missing class/race gracefully", () => {
    const attrs = buildAttributes(system, "unknown", "unknown");
    expect(attrs.str).toBe(10);
    expect(attrs.dex).toBe(10);
    expect(attrs.con).toBe(10);
  });
});

describe("profileToState", () => {
  const formulas: Record<string, FormulaDef> = {
    maxHp: { name: "Max HP", expression: "con * 2 + level * 5", min: 1 },
    maxMp: { name: "Max MP", expression: "int * 2 + level * 3", min: 0 },
    maxAp: { name: "Max AP", expression: "4", min: 1 },
  };

  const profile: CharacterProfile = {
    name: "TestHero",
    class: "warrior",
    race: "human",
    level: 1,
    experience: 0,
    attributes: { str: 14, dex: 12, con: 13, int: 10, wis: 10, cha: 12 },
    createdAt: new Date().toISOString(),
  };

  test("creates state with computed HP/MP/AP", () => {
    const state = profileToState(profile, "starter-town:town-square", formulas);
    expect(state.maxHp).toBe(31); // 13*2 + 1*5
    expect(state.currentHp).toBe(31);
    expect(state.maxMp).toBe(23); // 10*2 + 1*3
    expect(state.currentMp).toBe(23);
    expect(state.maxAp).toBe(4);
  });

  test("sets current room", () => {
    const state = profileToState(profile, "starter-town:town-square", formulas);
    expect(state.currentRoom).toBe("starter-town:town-square");
  });

  test("starts with empty inventory and effects", () => {
    const state = profileToState(profile, "spawn", formulas);
    expect(state.inventory).toEqual([]);
    expect(state.activeEffects).toEqual([]);
  });

  test("preserves profile fields", () => {
    const state = profileToState(profile, "spawn", formulas);
    expect(state.name).toBe("TestHero");
    expect(state.class).toBe("warrior");
    expect(state.race).toBe("human");
    expect(state.level).toBe(1);
    expect(state.attributes.str).toBe(14);
  });
});

describe("withDefaultFormulas", () => {
  const attributes = { str: 14, dex: 12, con: 13, int: 10, wis: 10, cha: 12 };

  test("fills missing maxHp/maxMp/maxAp with reference-system defaults", () => {
    const formulas = withDefaultFormulas({});
    const derived = computeDerivedStats(formulas, 1, attributes);

    expect(derived.maxHp).toBe(26); // 20 + 0 + floor(13 / 2)
    expect(derived.maxMp).toBe(13); // 10 + 0 + floor(10 / 3)
    expect(derived.maxAp).toBe(4); // 4 + floor((12 - 10) / 4)
  });

  test("defaults match the shipped reference system at higher levels", () => {
    const formulas = withDefaultFormulas({});
    const derived = computeDerivedStats(formulas, 3, attributes);

    expect(derived.maxHp).toBe(42); // 20 + 2 * 8 + floor(13 / 2)
    expect(derived.maxMp).toBe(21); // 10 + 2 * 4 + floor(10 / 3)
  });

  test("provided formulas win over defaults", () => {
    const formulas = withDefaultFormulas({
      maxHp: { name: "Max HP", expression: "100", min: 1 },
    });
    const derived = computeDerivedStats(formulas, 1, attributes);

    expect(derived.maxHp).toBe(100);
    expect(derived.maxMp).toBe(13); // default still fills the gap
  });

  test("preserves unrelated formulas", () => {
    const formulas = withDefaultFormulas({
      carryWeight: { name: "Carry Weight", expression: "50 + str * 5", min: 10 },
    });

    expect(formulas.carryWeight).toBeDefined();
    expect(formulas.maxHp).toBeDefined();
    expect(formulas.maxMp).toBeDefined();
    expect(formulas.maxAp).toBeDefined();
  });

  test("does not mutate its input", () => {
    const input: Record<string, FormulaDef> = {};
    withDefaultFormulas(input);
    expect(Object.keys(input)).toHaveLength(0);
  });

  test("respects the maxAp cap from the default formula", () => {
    const formulas = withDefaultFormulas({});
    const derived = computeDerivedStats(formulas, 1, { ...attributes, dex: 100 });
    expect(derived.maxAp).toBe(12); // capped by max: 12
  });
});
