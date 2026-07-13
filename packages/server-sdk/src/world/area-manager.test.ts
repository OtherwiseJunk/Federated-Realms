import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AreaManager } from "./area-manager.js";
import { NpcManager } from "../entities/npc-manager.js";
import { QuestManager } from "../systems/quest-manager.js";
import { CraftingSystem } from "../systems/crafting-system.js";

const MANIFEST_YML = `title: Test Area
description: An area for testing.
`;

const QUESTS_YML = `quests:
  - id: defaults
    name: Defaults Quest
    description: Every optional flag omitted.
    giver: elder
    objectives:
      - type: kill
        description: Kill a goblin
        target: goblin
  - id: explicit
    name: Explicit Quest
    description: Every optional flag set to its non-default value.
    giver: elder
    ordered: false
    repeatable: true
    consumeItems: false
    objectives:
      - type: collect
        description: Collect 5 herbs
        target: herb
        count: 5
`;

describe("AreaManager quest loading", () => {
  let tempDir: string;

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function loadQuests(): Promise<QuestManager> {
    tempDir = await mkdtemp(join(tmpdir(), "area-manager-test-"));
    const areaPath = join(tempDir, "test-area");
    await mkdir(areaPath);
    await writeFile(join(areaPath, "manifest.yml"), MANIFEST_YML);
    await writeFile(join(areaPath, "quests.yml"), QUESTS_YML);

    const questManager = new QuestManager();
    const areaManager = new AreaManager(new NpcManager(), questManager, new CraftingSystem());
    await areaManager.loadFromDirectory(tempDir);
    return questManager;
  }

  test("resolves lexicon defaults when quests.yml omits optional flags", async () => {
    const questManager = await loadQuests();
    const def = questManager.getDefinition("test-area:defaults")!;

    expect(def).toBeDefined();
    expect(def.ordered).toBe(true);
    expect(def.repeatable).toBe(false);
    expect(def.consumeItems).toBe(true);
    expect(def.objectives[0].count).toBe(1);
  });

  test("passes explicit non-default flags through from quests.yml", async () => {
    const questManager = await loadQuests();
    const def = questManager.getDefinition("test-area:explicit")!;

    expect(def).toBeDefined();
    expect(def.ordered).toBe(false);
    expect(def.repeatable).toBe(true);
    expect(def.consumeItems).toBe(false);
    expect(def.objectives[0].count).toBe(5);
  });
});
