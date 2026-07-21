import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  spyOn,
} from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

const QUEST_MANIFEST_YML = `title: Test Area
description: An area for testing.
`;

const QUEST_FLAGS_YML = `quests:
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
    await writeFile(join(areaPath, "manifest.yml"), QUEST_MANIFEST_YML);
    await writeFile(join(areaPath, "quests.yml"), QUEST_FLAGS_YML);

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

const COOLDOWN_MANIFEST_YML = `title: Test Area
description: An area for testing.
`;

describe("AreaManager attackCooldown loading", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  async function loadNpcs(npcsYml: string): Promise<NpcManager> {
    tempDir = await mkdtemp(join(tmpdir(), "area-manager-cooldown-"));
    const areaPath = join(tempDir, "test-area");
    await mkdir(areaPath);
    await writeFile(join(areaPath, "manifest.yml"), COOLDOWN_MANIFEST_YML);
    await writeFile(join(areaPath, "npcs.yml"), npcsYml);

    const npcManager = new NpcManager();
    const areaManager = new AreaManager(npcManager, new QuestManager(), new CraftingSystem());
    await areaManager.loadFromDirectory(tempDir);
    return npcManager;
  }

  test("passes attackCooldown through to the registered definition", async () => {
    const npcManager = await loadNpcs(
      "definitions:\n" +
        "  - id: tiger\n    name: Tiger\n    description: A big cat.\n" +
        "    behavior: hostile\n    level: 3\n    attackCooldown: 3\n",
    );
    expect(npcManager.getDefinition("test-area:tiger")?.attackCooldown).toBe(3);
  });

  test("leaves attackCooldown undefined when YAML omits it", async () => {
    const npcManager = await loadNpcs(
      "definitions:\n" +
        "  - id: rat\n    name: Rat\n    description: A rat.\n    behavior: hostile\n",
    );
    expect(npcManager.getDefinition("test-area:rat")?.attackCooldown).toBeUndefined();
  });

  test("rejects a non-positive attackCooldown with id context", async () => {
    await expect(
      loadNpcs(
        "definitions:\n" +
          "  - id: broken\n    name: Broken\n    description: x\n" +
          "    behavior: hostile\n    attackCooldown: 0\n",
      ),
    ).rejects.toThrow(/broken.*attackCooldown/);
  });
});

const ENUM_MANIFEST_YML = `title: Enum Area
description: An area for enum validation tests.
`;

describe("AreaManager enum validation", () => {
  let tempDir: string;
  let silenceLog: ReturnType<typeof spyOn>;
  let silenceWarn: ReturnType<typeof spyOn>;

  beforeEach(() => {
    silenceLog = spyOn(console, "log").mockImplementation(() => {});
    silenceWarn = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    silenceLog.mockRestore();
    silenceWarn.mockRestore();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  async function loadArea(files: Record<string, string>): Promise<void> {
    tempDir = await mkdtemp(join(tmpdir(), "area-manager-enum-"));
    const areaPath = join(tempDir, "enum-area");
    await mkdir(areaPath);
    await writeFile(join(areaPath, "manifest.yml"), ENUM_MANIFEST_YML);
    for (const [name, contents] of Object.entries(files)) {
      await writeFile(join(areaPath, name), contents);
    }
    const areaManager = new AreaManager(new NpcManager(), new QuestManager(), new CraftingSystem());
    await areaManager.loadFromDirectory(tempDir);
  }

  test("rejects an unknown room exit direction with file and id context", async () => {
    const rooms = `- id: gate
  title: The Gate
  description: A gate.
  coordinates: { x: 0, y: 0, z: 0 }
  exits:
    - direction: nrth
      target: hall
`;
    const promise = loadArea({ "rooms.yml": rooms });
    await expect(promise).rejects.toThrow(/nrth/);
    await expect(loadArea({ "rooms.yml": rooms })).rejects.toThrow(/gate/);
  });

  test("rejects an unknown NPC behavior with file and id context", async () => {
    const npcs = `definitions:
  - id: keeper
    name: Web Keeper
    description: A merchant.
    behavior: merchnat
`;
    await expect(loadArea({ "npcs.yml": npcs })).rejects.toThrow(/merchnat/);
    await expect(loadArea({ "npcs.yml": npcs })).rejects.toThrow(/keeper/);
  });

  test("rejects an unknown quest objective type with file and id context", async () => {
    const quests = `quests:
  - id: gather
    name: Gather
    description: Gather things.
    objectives:
      - type: kil
        description: Kill something.
        target: goblin
`;
    await expect(loadArea({ "quests.yml": quests })).rejects.toThrow(/kil/);
    await expect(loadArea({ "quests.yml": quests })).rejects.toThrow(/gather/);
  });

  test("accepts known enum values", async () => {
    const rooms = `- id: gate
  title: The Gate
  description: A gate.
  coordinates: { x: 0, y: 0, z: 0 }
  exits:
    - direction: north
      target: hall
`;
    const npcs = `definitions:
  - id: keeper
    name: Web Keeper
    description: A merchant.
    behavior: merchant
`;
    await expect(loadArea({ "rooms.yml": rooms, "npcs.yml": npcs })).resolves.toBeUndefined();
  });
});
