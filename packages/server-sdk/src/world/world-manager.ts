import { AreaManager } from "./area-manager.js";
import { loadGameSystem } from "./system-loader.js";
import { Room } from "./room.js";
import type { GameSystem } from "@realms/common";
import type { ServerConfig } from "../types/server-config.js";
import { NpcManager } from "../entities/npc-manager.js";
import { QuestManager } from "../systems/quest-manager.js";
import { CraftingSystem } from "../systems/crafting-system.js";

export class WorldManager {
  readonly areaManager: AreaManager;
  readonly npcManager: NpcManager;
  readonly questManager: QuestManager;
  readonly craftingSystem: CraftingSystem;
  gameSystem!: GameSystem;
  private config: ServerConfig;
  private requiredAttributes: readonly string[];

  constructor(config: ServerConfig, requiredAttributes: readonly string[] = []) {
    this.config = config;
    this.requiredAttributes = requiredAttributes;
    this.npcManager = new NpcManager();
    this.questManager = new QuestManager();
    this.craftingSystem = new CraftingSystem();
    this.areaManager = new AreaManager(this.npcManager, this.questManager, this.craftingSystem);
  }

  async initialize(): Promise<void> {
    this.gameSystem = await loadGameSystem(this.config.dataPath, this.requiredAttributes);

    // Give the NPC manager the system's attribute definitions before any NPCs
    // spawn during area loading, so each NPC inherits the configured attribute
    // defaults instead of a hardcoded fallback.
    this.npcManager.setAttributeDefs(this.gameSystem.attributes);

    const areasPath = `${this.config.dataPath}/areas`;
    await this.areaManager.loadFromDirectory(areasPath);

    const totalRooms = this.areaManager.getAllRooms().size;
    console.log(`World loaded: ${totalRooms} rooms total`);

    const spawnRoom = this.getRoom(this.config.defaultSpawnRoom);
    if (!spawnRoom) {
      throw new Error(`Default spawn room not found: ${this.config.defaultSpawnRoom}`);
    }
  }

  getRoom(id: string): Room | undefined {
    return this.areaManager.getRoom(id);
  }

  getDefaultSpawnRoom(): string {
    return this.config.defaultSpawnRoom;
  }
}
