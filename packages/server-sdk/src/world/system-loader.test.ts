import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGameSystem } from "./system-loader.js";

describe("loadGameSystem", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function writeSystem(yaml: string): string {
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
});
