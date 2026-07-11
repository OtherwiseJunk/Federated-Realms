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

  constructor(config: ServerConfig) {
    this.config = config;
    this.npcManager = new NpcManager();
    this.questManager = new QuestManager();
    this.craftingSystem = new CraftingSystem();
    this.areaManager = new AreaManager(this.npcManager, this.questManager, this.craftingSystem);
  }

  async initialize(): Promise<void> {
    this.gameSystem = await loadGameSystem(this.config.dataPath);

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
