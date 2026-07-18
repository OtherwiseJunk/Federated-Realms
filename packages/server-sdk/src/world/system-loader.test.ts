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

  // The loader now asserts the core combat attributes (str/dex/con) are declared,
  // so every fixture that expects a successful (or spell-level) load must declare
  // them. `int`/`wis` are included for spell casting attributes.
  const CORE_ATTRS = `attributes:
  str:
    name: Strength
    defaultValue: 10
  dex:
    name: Dexterity
    defaultValue: 10
  con:
    name: Constitution
    defaultValue: 10
  int:
    name: Intelligence
    defaultValue: 10
  wis:
    name: Wisdom
    defaultValue: 10
`;

  function writeSystem(yaml: string): string {
    silenceLog = spyOn(console, "log").mockImplementation(() => {});
    const root = mkdtempSync(join(tmpdir(), "realms-system-"));
    tempRoots.push(root);
    writeFileSync(join(root, "system.yml"), yaml);
    return root;
  }

  test("fills missing derived-stat formulas with reference defaults", async () => {
    const dataPath = writeSystem(CORE_ATTRS);

    const system = await loadGameSystem(dataPath);

    expect(system.formulas.maxHp).toBeDefined();
    expect(system.formulas.maxMp).toBeDefined();
    expect(system.formulas.maxAp).toBeDefined();
    expect(system.formulas.maxHp.expression).toBe("20 + (level - 1) * 8 + floor(con / 2)");
  });

  test("loads weightScale, defaulting to 1 when omitted", async () => {
    const declared = await loadGameSystem(writeSystem(`weightScale: 10\n${CORE_ATTRS}`));
    expect(declared.weightScale).toBe(10);

    const defaulted = await loadGameSystem(writeSystem(CORE_ATTRS));
    expect(defaulted.weightScale).toBe(1);
  });

  test("keeps formulas defined in the system YAML", async () => {
    const dataPath = writeSystem(`${CORE_ATTRS}
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

  const VALID_SPELL = `${CORE_ATTRS}
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
    const system = await loadGameSystem(writeSystem(CORE_ATTRS));
    expect(Object.keys(system.spells)).toHaveLength(0);
    expect(Object.keys(system.classes)).toHaveLength(0);
  });

  test("rejects a spell with an unknown effect, naming the spell", async () => {
    const dataPath = writeSystem(`${CORE_ATTRS}
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
    const dataPath = writeSystem(`${CORE_ATTRS}
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

  test("rejects a system missing a caller-required combat attribute, naming it", async () => {
    // Declares str/dex but omits con — combat would read attrs.con → NaN.
    const dataPath = writeSystem(`attributes:
  str:
    name: Strength
  dex:
    name: Dexterity
`);
    await expect(loadGameSystem(dataPath, ["str", "dex", "con"])).rejects.toThrow(/con/);
    await expect(loadGameSystem(dataPath, ["str", "dex", "con"])).rejects.toThrow(
      /combat attribute/,
    );
  });

  test("rejects a system that declares no attributes at all", async () => {
    const dataPath = writeSystem("classes:\n  warrior:\n    name: Warrior\n");
    await expect(loadGameSystem(dataPath, ["str", "dex", "con"])).rejects.toThrow(/str/);
  });

  test("makes no attribute assumption when the caller passes no required set", async () => {
    // A system with entirely non-standard attribute names loads fine — the SDK
    // loader is system-agnostic; required attributes come from the caller's rules.
    const system = await loadGameSystem(writeSystem("attributes:\n  might:\n    name: Might\n"));
    expect(Object.keys(system.attributes)).toEqual(["might"]);
  });

  test("validates against whatever required set the caller passes", async () => {
    const dataPath = writeSystem("attributes:\n  might:\n    name: Might\n");
    await expect(loadGameSystem(dataPath, ["might"])).resolves.toBeDefined();
    await expect(loadGameSystem(dataPath, ["reflexes"])).rejects.toThrow(/reflexes/);
  });

  test("rejects a spell referencing an undeclared attribute, naming the spell", async () => {
    // Core attrs are present, but the spell casts off an attribute the system
    // never declares — casterAttrs[spell.attribute] would be NaN.
    const dataPath = writeSystem(`${CORE_ATTRS}
spells:
  mindblast:
    name: Mind Blast
    description: Psychic assault.
    mpCost: 6
    attribute: psi
    effect: damage
    power: 12
    target: enemy
`);
    await expect(loadGameSystem(dataPath)).rejects.toThrow(/mindblast/);
    await expect(loadGameSystem(dataPath)).rejects.toThrow(/psi/);
  });
});
