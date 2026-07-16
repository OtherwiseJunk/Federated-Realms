import { afterEach, describe, expect, test, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGameSystem } from "./system-loader.js";

describe("loadGameSystem", () => {
  const tempRoots: string[] = [];
  let silenceLog: ReturnType<typeof spyOn>;

  afterEach(() => {
    silenceLog?.mockRestore();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function writeSystem(yaml: string): string {
    silenceLog = spyOn(console, "log").mockImplementation(() => {});
    const root = mkdtempSync(join(tmpdir(), "realms-system-"));
    tempRoots.push(root);
    writeFileSync(join(root, "system.yml"), yaml);
    return root;
  }

  test("fills missing derived-stat formulas with reference defaults", async () => {
    const dataPath = writeSystem(`
attributes:
  con:
    name: Constitution
    defaultValue: 10
`);

    const system = await loadGameSystem(dataPath);

    expect(system.formulas.maxHp).toBeDefined();
    expect(system.formulas.maxMp).toBeDefined();
    expect(system.formulas.maxAp).toBeDefined();
    expect(system.formulas.maxHp.expression).toBe("20 + (level - 1) * 8 + floor(con / 2)");
  });

  test("keeps formulas defined in the system YAML", async () => {
    const dataPath = writeSystem(`
formulas:
  maxHp:
    name: Max Hit Points
    expression: "50 + level * 10"
    min: 1
  carryWeight:
    name: Carry Weight
    expression: "50 + str * 5"
    min: 10
`);

    const system = await loadGameSystem(dataPath);

    expect(system.formulas.maxHp.expression).toBe("50 + level * 10");
    expect(system.formulas.carryWeight.expression).toBe("50 + str * 5");
    // The gaps are still defaulted
    expect(system.formulas.maxMp).toBeDefined();
    expect(system.formulas.maxAp).toBeDefined();
  });

  const VALID_SPELL = `
spells:
  fireball:
    name: Fireball
    description: A ball of fire.
    mpCost: 5
    attribute: int
    effect: damage
    power: 10
    target: enemy
`;

  test("loads a system with a valid spell", async () => {
    const system = await loadGameSystem(writeSystem(VALID_SPELL));
    expect(system.spells.fireball.effect).toBe("damage");
    expect(system.spells.fireball.target).toBe("enemy");
  });

  test("loads a system whose sections are entirely omitted", async () => {
    const system = await loadGameSystem(writeSystem("attributes:\n  con:\n    name: Con\n"));
    expect(Object.keys(system.spells)).toHaveLength(0);
    expect(Object.keys(system.classes)).toHaveLength(0);
  });

  test("rejects a spell with an unknown effect, naming the spell", async () => {
    const dataPath = writeSystem(`
spells:
  fireball:
    name: Fireball
    description: A ball of fire.
    mpCost: 5
    attribute: int
    effect: damag
    power: 10
    target: enemy
`);
    await expect(loadGameSystem(dataPath)).rejects.toThrow(/damag/);
    await expect(loadGameSystem(dataPath)).rejects.toThrow(/fireball/);
  });

  test("rejects a spell with an unknown target, naming the spell", async () => {
    const dataPath = writeSystem(`
spells:
  heal:
    name: Heal
    description: Restore health.
    mpCost: 4
    attribute: wis
    effect: heal
    power: 8
    target: freind
`);
    await expect(loadGameSystem(dataPath)).rejects.toThrow(/freind/);
    await expect(loadGameSystem(dataPath)).rejects.toThrow(/heal/);
  });
});
