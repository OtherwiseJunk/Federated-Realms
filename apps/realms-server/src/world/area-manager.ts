import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { RoomRecord, ItemDefinition, NpcDefinition, NpcBehavior } from "@realms/lexicons";
import { Room } from "./room.js";
import { createItemInstance, type ItemRegistry } from "@realms/common";
import { NpcManager, type LootEntry } from "../entities/npc-manager.js";
import { QuestManager } from "../systems/quest-manager.js";
import { CraftingSystem } from "../systems/crafting-system.js";

interface AreaManifest {
  id: string;
  title: string;
  description: string;
  levelRange?: { min: number; max: number };
}

interface RoomFeatureDef {
  name: string;
  keywords?: string[];
  description: string;
}

interface RoomDef {
  id: string;
  title: string;
  description: string;
  coordinates: { x: number; y: number; z: number };
  exits?: Array<{
    direction: string;
    target: string;
    portal?: boolean;
    requiredLevel?: number;
    description?: string;
  }>;
  flags?: string[];
  features?: RoomFeatureDef[];
}

interface ItemDef {
  id: string;
  name: string;
  type: string;
  description: string;
  weight?: number;
  value?: number;
  rarity?: string;
  levelRequired?: number;
  stackable?: boolean;
  maxStack?: number;
  properties?: Record<string, unknown>;
  tags?: string[];
}

interface ItemSpawn {
  room: string;
  items: Array<{ id: string; quantity: number }>;
}

interface ItemsFile {
  definitions: ItemDef[];
  spawns?: ItemSpawn[];
}

interface NpcDef {
  id: string;
  name: string;
  description: string;
  behavior: string;
  level?: number;
  attributes?: Record<string, number>;
  dialogue?: Record<string, { text: string; responses?: Array<{ text: string; next?: string }> }>;
  art?: string[];
  shop?: string[];
  gold?: { min: number; max: number };
  loot?: LootEntry[];
  tags?: string[];
}

interface NpcSpawn {
  room: string;
  npcs: Array<{ id: string }>;
}

interface NpcsFile {
  definitions: NpcDef[];
  spawns?: NpcSpawn[];
}

interface QuestObjectiveDef {
  type: string;
  description: string;
  target?: string;
  count?: number;
}

interface QuestRewardsDef {
  xp?: number;
  gold?: number;
  items?: string[];
}

interface QuestDef {
  id: string;
  name: string;
  description: string;
  level?: number;
  giver?: string;
  turnIn?: string;
  prerequisites?: string[];
  objectives: QuestObjectiveDef[];
  rewards?: QuestRewardsDef;
  repeatable?: boolean;
  tags?: string[];
}

interface QuestsFile {
  quests: QuestDef[];
}

interface RecipeIngredientYaml {
  itemId: string;
  count: number;
}

interface RecipeOutputYaml {
  itemId: string;
  count: number;
}

interface RecipeDef {
  id: string;
  name: string;
  description?: string;
  station?: string;
  levelRequired?: number;
  ingredients: RecipeIngredientYaml[];
  output: RecipeOutputYaml;
  successChance?: number;
  tags?: string[];
}

interface RecipesFile {
  recipes: RecipeDef[];
}

interface GatherYieldYaml {
  itemId: string;
  chance: number;
  min: number;
  max: number;
}

interface GatherNodeYaml {
  id: string;
  name: string;
  description: string;
  room: string;
  respawnSeconds: number;
  yields: GatherYieldYaml[];
}

interface GatheringFile {
  nodes: GatherNodeYaml[];
}

export class AreaManager {
  private rooms = new Map<string, Room>();
  private areas = new Map<string, AreaManifest>();
  private itemDefinitions: ItemRegistry = new Map();
  private npcManager: NpcManager;
  private questManager: QuestManager;
  private craftingSystem: CraftingSystem;

  constructor(npcManager: NpcManager, questManager: QuestManager, craftingSystem: CraftingSystem) {
    this.npcManager = npcManager;
    this.questManager = questManager;
    this.craftingSystem = craftingSystem;
  }

  async loadFromDirectory(basePath: string): Promise<void> {
    const entries = await readdir(basePath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const areaPath = join(basePath, entry.name);
      await this.loadArea(entry.name, areaPath);
    }
  }

  private async loadArea(areaId: string, areaPath: string): Promise<void> {
    // Load manifest
    const manifestFile = Bun.file(join(areaPath, "manifest.yml"));
    if (!(await manifestFile.exists())) {
      console.warn(`No manifest.yml found in area: ${areaId}`);
      return;
    }

    const manifestText = await manifestFile.text();
    const manifest: AreaManifest = { id: areaId, ...parseYaml(manifestText) };
    this.areas.set(areaId, manifest);

    // Load rooms
    const roomsFile = Bun.file(join(areaPath, "rooms.yml"));
    if (await roomsFile.exists()) {
      const roomsText = await roomsFile.text();
      const roomDefs: RoomDef[] = parseYaml(roomsText);

      for (const def of roomDefs) {
        const roomId = `${areaId}:${def.id}`;
        const record: RoomRecord = {
          title: def.title,
          description: def.description,
          area: areaId,
          coordinates: def.coordinates,
          exits: def.exits?.map((e) => ({
            direction: e.direction as any,
            target: e.target.includes(":") ? e.target : `${areaId}:${e.target}`,
            portal: e.portal,
            requiredLevel: e.requiredLevel,
            description: e.description,
          })),
          flags: def.flags,
        };
        const features = def.features?.map((f) => ({
          name: f.name,
          keywords: f.keywords ?? [f.name.toLowerCase()],
          description: f.description,
        }));
        this.rooms.set(roomId, new Room(roomId, record, features));
      }
    }

    // Load items
    const itemsFile = Bun.file(join(areaPath, "items.yml"));
    if (await itemsFile.exists()) {
      const itemsText = await itemsFile.text();
      const itemsData: ItemsFile = parseYaml(itemsText);
      let itemCount = 0;

      // Register definitions
      for (const def of itemsData.definitions) {
        const defId = `${areaId}:${def.id}`;
        const itemDef: ItemDefinition = {
          name: def.name,
          type: def.type,
          description: def.description,
          weight: def.weight,
          value: def.value,
          rarity: def.rarity,
          levelRequired: def.levelRequired,
          stackable: def.stackable,
          maxStack: def.maxStack,
          properties: def.properties,
          tags: def.tags,
        };
        this.itemDefinitions.set(defId, itemDef);
        itemCount++;
      }

      // Spawn items into rooms
      if (itemsData.spawns) {
        for (const spawn of itemsData.spawns) {
          const roomId = `${areaId}:${spawn.room}`;
          const room = this.rooms.get(roomId);
          if (!room) {
            console.warn(`Item spawn references unknown room: ${roomId}`);
            continue;
          }
          for (const item of spawn.items) {
            const defId = `${areaId}:${item.id}`;
            const def = this.itemDefinitions.get(defId);
            if (!def) {
              console.warn(`Item spawn references unknown item: ${defId}`);
              continue;
            }
            if (def.stackable) {
              // Stackable items: one instance with full quantity
              room.addGroundItem(createItemInstance(defId, def, item.quantity), true);
            } else {
              // Non-stackable items: spawn separate instances
              for (let n = 0; n < item.quantity; n++) {
                room.addGroundItem(createItemInstance(defId, def, 1));
              }
            }
          }
        }
      }

      console.log(`  Items: ${itemCount} definitions loaded`);
    }

    // Load NPCs
    const npcsFile = Bun.file(join(areaPath, "npcs.yml"));
    if (await npcsFile.exists()) {
      const npcsText = await npcsFile.text();
      const npcsData: NpcsFile = parseYaml(npcsText);
      let npcCount = 0;

      // Register definitions
      for (const def of npcsData.definitions) {
        const defId = `${areaId}:${def.id}`;
        const npcDef: NpcDefinition = {
          name: def.name,
          description: def.description,
          behavior: def.behavior as NpcBehavior,
          level: def.level,
          attributes: def.attributes,
          dialogue: def.dialogue as NpcDefinition["dialogue"],
          art: def.art,
          shop: def.shop?.map((id) => (id.includes(":") ? id : `${areaId}:${id}`)),
          tags: def.tags,
        };
        this.npcManager.registerDefinition(defId, npcDef, def.loot, def.gold);
        npcCount++;
      }

      // Spawn NPCs into rooms
      if (npcsData.spawns) {
        for (const spawn of npcsData.spawns) {
          const roomId = `${areaId}:${spawn.room}`;
          const room = this.rooms.get(roomId);
          if (!room) {
            console.warn(`NPC spawn references unknown room: ${roomId}`);
            continue;
          }
          for (const npc of spawn.npcs) {
            const defId = `${areaId}:${npc.id}`;
            this.npcManager.spawnNpc(defId, room);
          }
        }
      }

      console.log(`  NPCs: ${npcCount} definitions loaded`);
    }

    // Load quests
    const questsFile = Bun.file(join(areaPath, "quests.yml"));
    if (await questsFile.exists()) {
      const questsText = await questsFile.text();
      const questsData: QuestsFile = parseYaml(questsText);
      let questCount = 0;

      for (const q of questsData.quests) {
        const questId = `${areaId}:${q.id}`;
        const prefixId = (id: string) => (id.includes(":") ? id : `${areaId}:${id}`);

        this.questManager.registerDefinition(questId, {
          name: q.name,
          description: q.description,
          level: q.level,
          giver: q.giver ? prefixId(q.giver) : undefined,
          turnIn: q.turnIn ? prefixId(q.turnIn) : undefined,
          prerequisites: q.prerequisites?.map(prefixId),
          objectives: q.objectives.map((o) => ({
            type: o.type as any,
            description: o.description,
            target: o.target ? prefixId(o.target) : undefined,
            count: o.count,
          })),
          rewards: q.rewards
            ? {
                xp: q.rewards.xp,
                gold: q.rewards.gold,
                items: q.rewards.items?.map(prefixId),
              }
            : undefined,
          repeatable: q.repeatable,
          tags: q.tags,
        });
        questCount++;
      }

      console.log(`  Quests: ${questCount} definitions loaded`);
    }

    // Load recipes
    const recipesFile = Bun.file(join(areaPath, "recipes.yml"));
    if (await recipesFile.exists()) {
      const recipesText = await recipesFile.text();
      const recipesData: RecipesFile = parseYaml(recipesText);
      let recipeCount = 0;

      for (const r of recipesData.recipes) {
        const recipeId = `${areaId}:${r.id}`;
        const prefixId = (id: string) => (id.includes(":") ? id : `${areaId}:${id}`);

        this.craftingSystem.registerRecipe(recipeId, {
          name: r.name,
          description: r.description,
          station: r.station,
          levelRequired: r.levelRequired,
          ingredients: r.ingredients.map((ing) => ({
            itemId: prefixId(ing.itemId),
            count: ing.count,
          })),
          output: {
            itemId: prefixId(r.output.itemId),
            count: r.output.count,
          },
          successChance: r.successChance,
          tags: r.tags,
        });
        recipeCount++;
      }

      console.log(`  Recipes: ${recipeCount} definitions loaded`);
    }

    // Load gathering nodes
    const gatheringFile = Bun.file(join(areaPath, "gathering.yml"));
    if (await gatheringFile.exists()) {
      const gatheringText = await gatheringFile.text();
      const gatheringData: GatheringFile = parseYaml(gatheringText);
      let nodeCount = 0;

      for (const n of gatheringData.nodes) {
        const prefixId = (id: string) => (id.includes(":") ? id : `${areaId}:${id}`);
        const nodeId = `${areaId}:${n.id}`;
        const roomId = `${areaId}:${n.room}`;

        this.craftingSystem.registerGatheringNode({
          id: nodeId,
          name: n.name,
          description: n.description,
          roomId,
          respawnSeconds: n.respawnSeconds,
          yields: n.yields.map((y) => ({
            itemId: prefixId(y.itemId),
            chance: y.chance,
            min: y.min,
            max: y.max,
          })),
        });
        nodeCount++;
      }

      console.log(`  Gathering nodes: ${nodeCount} loaded`);
    }

    console.log(`Loaded area: ${manifest.title} (${this.getRoomCountForArea(areaId)} rooms)`);
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  getAllRooms(): Map<string, Room> {
    return this.rooms;
  }

  getArea(id: string): AreaManifest | undefined {
    return this.areas.get(id);
  }

  getAllAreas(): Map<string, AreaManifest> {
    return this.areas;
  }

  getItemDefinition(id: string): ItemDefinition | undefined {
    return this.itemDefinitions.get(id);
  }

  getAllItemDefinitions(): ItemRegistry {
    return this.itemDefinitions;
  }

  private getRoomCountForArea(areaId: string): number {
    let count = 0;
    for (const key of this.rooms.keys()) {
      if (key.startsWith(`${areaId}:`)) count++;
    }
    return count;
  }
}
