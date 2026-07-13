import { afterAll, beforeAll, describe, expect, test, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AreaManager } from "./area-manager.js";
import { NpcManager } from "../entities/npc-manager.js";
import { QuestManager } from "../systems/quest-manager.js";
import { CraftingSystem } from "../systems/crafting-system.js";

const MANIFEST_YML = `
title: Test Forest
description: A forest for tests.
`;

const ITEMS_YML = `
definitions:
  - id: spider-silk
    name: Spider Silk
    type: material
    description: Strong silk.
    stackable: true
    maxStack: 20
`;

const NPCS_YML = `
definitions:
  - id: spider
    name: Forest Spider
    description: A test spider.
    behavior: hostile
    level: 2
    loot:
      - itemId: spider-silk
        chance: 100
  - id: keeper
    name: Web Keeper
    description: A test merchant.
    behavior: merchant
    shop:
      - spider-silk
      - other-area:gem
`;

const QUESTS_YML = `
quests:
  - id: gather-silk
    name: Gather Silk
    description: Collect silk.
    giver: keeper
    turnIn: keeper
    objectives:
      - type: collect
        description: Collect spider silk.
        target: spider-silk
        count: 3
    rewards:
      items:
        - spider-silk
`;

const RECIPES_YML = `
recipes:
  - id: silk-rope
    name: Silk Rope
    ingredients:
      - itemId: spider-silk
        count: 2
    output:
      itemId: other-area:rope
      count: 1
`;

const GATHERING_YML = `
nodes:
  - id: web-cache
    name: Web Cache
    description: A web full of silk.
    room: clearing
    respawnSeconds: 60
    yields:
      - itemId: spider-silk
        chance: 100
        min: 1
        max: 1
`;

describe("AreaManager YAML id prefixing", () => {
  let basePath: string;
  let areaManager: AreaManager;
  let npcManager: NpcManager;
  let questManager: QuestManager;
  let craftingSystem: CraftingSystem;
  let silenceLog: ReturnType<typeof spyOn>;

  beforeAll(async () => {
    silenceLog = spyOn(console, "log").mockImplementation(() => {});
    basePath = mkdtempSync(join(tmpdir(), "realms-areas-"));
    const areaPath = join(basePath, "test-forest");
    mkdirSync(areaPath);
    writeFileSync(join(areaPath, "manifest.yml"), MANIFEST_YML);
    writeFileSync(join(areaPath, "items.yml"), ITEMS_YML);
    writeFileSync(join(areaPath, "npcs.yml"), NPCS_YML);
    writeFileSync(join(areaPath, "quests.yml"), QUESTS_YML);
    writeFileSync(join(areaPath, "recipes.yml"), RECIPES_YML);
    writeFileSync(join(areaPath, "gathering.yml"), GATHERING_YML);

    npcManager = new NpcManager();
    questManager = new QuestManager();
    craftingSystem = new CraftingSystem();
    areaManager = new AreaManager(npcManager, questManager, craftingSystem);
    await areaManager.loadFromDirectory(basePath);
  });

  afterAll(() => {
    rmSync(basePath, { recursive: true, force: true });
    silenceLog.mockRestore();
  });

  test("registers item definitions under prefixed ids", () => {
    expect(areaManager.getItemDefinition("test-forest:spider-silk")?.name).toBe("Spider Silk");
  });

  test("prefixes NPC loot table item ids so loot resolves and drops", () => {
    const drops = npcManager.generateLoot("test-forest:spider", (id) =>
      areaManager.getItemDefinition(id),
    );

    expect(drops).toHaveLength(1);
    expect(drops[0].definitionId).toBe("test-forest:spider-silk");
    expect(drops[0].name).toBe("Spider Silk");
  });

  test("prefixes shop item ids, leaving already-prefixed ids alone", () => {
    const keeper = npcManager.getDefinition("test-forest:keeper");
    expect(keeper?.shop).toEqual(["test-forest:spider-silk", "other-area:gem"]);
  });

  test("prefixes quest giver, turn-in, objective targets, and reward items", () => {
    const quest = questManager.getDefinition("test-forest:gather-silk");
    expect(quest?.giver).toBe("test-forest:keeper");
    expect(quest?.turnIn).toBe("test-forest:keeper");
    expect(quest?.objectives[0].target).toBe("test-forest:spider-silk");
    expect(quest?.rewards?.items).toEqual(["test-forest:spider-silk"]);
  });

  test("prefixes recipe ingredient and output item ids, leaving prefixed ids alone", () => {
    const recipe = craftingSystem.getRecipe("test-forest:silk-rope");
    expect(recipe?.ingredients[0].itemId).toBe("test-forest:spider-silk");
    expect(recipe?.output.itemId).toBe("other-area:rope");
  });

  test("prefixes gathering node yield item ids", () => {
    const nodes = craftingSystem.getNodesInRoom("test-forest:clearing");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].yields[0].itemId).toBe("test-forest:spider-silk");
  });
});
