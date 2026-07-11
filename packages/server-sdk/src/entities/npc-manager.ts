import type { NpcDefinition, ItemDefinition } from "@realms/lexicons";
import type { NpcInstance, ItemInstance } from "@realms/common";
import { createNpcInstance, createItemInstance } from "@realms/common";
import type { Room } from "../world/room.js";

export interface LootEntry {
  itemId: string;
  chance: number;
  minQuantity?: number;
  maxQuantity?: number;
}

interface RespawnEntry {
  definitionId: string;
  roomId: string;
  respawnAt: number;
}

export interface GoldDrop {
  min: number;
  max: number;
}

export class NpcManager {
  private definitions = new Map<string, NpcDefinition>();
  private lootTables = new Map<string, LootEntry[]>();
  private goldDrops = new Map<string, GoldDrop>();
  private instances = new Map<string, NpcInstance>();
  private respawnQueue: RespawnEntry[] = [];

  static RESPAWN_TIME_MS = 30_000;

  registerDefinition(id: string, def: NpcDefinition, loot?: LootEntry[], gold?: GoldDrop): void {
    this.definitions.set(id, def);
    if (loot && loot.length > 0) {
      this.lootTables.set(id, loot);
    }
    if (gold) {
      this.goldDrops.set(id, gold);
    }
  }

  generateGoldDrop(definitionId: string): number {
    const drop = this.goldDrops.get(definitionId);
    if (!drop) return 0;
    return Math.floor(Math.random() * (drop.max - drop.min + 1)) + drop.min;
  }

  getDefinition(id: string): NpcDefinition | undefined {
    return this.definitions.get(id);
  }

  spawnNpc(definitionId: string, room: Room): NpcInstance | undefined {
    const def = this.definitions.get(definitionId);
    if (!def) return undefined;

    const instance = createNpcInstance(definitionId, def, room.id);
    this.instances.set(instance.instanceId, instance);
    room.addNpc(instance.instanceId, instance.name);

    return instance;
  }

  getInstance(instanceId: string): NpcInstance | undefined {
    return this.instances.get(instanceId);
  }

  findInRoom(roomId: string, name: string): NpcInstance | undefined {
    const lower = name.toLowerCase();
    for (const npc of this.instances.values()) {
      if (
        npc.currentRoom === roomId &&
        npc.state !== "dead" &&
        npc.name.toLowerCase().includes(lower)
      ) {
        return npc;
      }
    }
    return undefined;
  }

  getAllInRoom(roomId: string): NpcInstance[] {
    const result: NpcInstance[] = [];
    for (const npc of this.instances.values()) {
      if (npc.currentRoom === roomId && npc.state !== "dead") {
        result.push(npc);
      }
    }
    return result;
  }

  damageNpc(instanceId: string, amount: number): boolean {
    const npc = this.instances.get(instanceId);
    if (!npc) return false;

    npc.currentHp = Math.max(0, npc.currentHp - amount);

    if (npc.currentHp <= 0) {
      npc.state = "dead";
      return true;
    }

    return false;
  }

  killNpc(instanceId: string, room: Room): void {
    const npc = this.instances.get(instanceId);
    if (!npc) return;

    npc.state = "dead";
    npc.currentHp = 0;

    room.removeNpc(instanceId);

    this.respawnQueue.push({
      definitionId: npc.definitionId,
      roomId: npc.currentRoom,
      respawnAt: Date.now() + NpcManager.RESPAWN_TIME_MS,
    });

    this.instances.delete(instanceId);
  }

  generateLoot(
    definitionId: string,
    getItemDef: (id: string) => ItemDefinition | undefined,
  ): ItemInstance[] {
    const loot = this.lootTables.get(definitionId);
    if (!loot) return [];

    const drops: ItemInstance[] = [];
    for (const entry of loot) {
      const roll = Math.random() * 100;
      if (roll < entry.chance) {
        const itemDef = getItemDef(entry.itemId);
        if (itemDef) {
          const qty =
            entry.minQuantity && entry.maxQuantity
              ? Math.floor(Math.random() * (entry.maxQuantity - entry.minQuantity + 1)) +
                entry.minQuantity
              : (entry.minQuantity ?? 1);
          drops.push(createItemInstance(entry.itemId, itemDef, qty));
        }
      }
    }

    return drops;
  }

  processRespawns(getRoom: (id: string) => Room | undefined): NpcInstance[] {
    const now = Date.now();
    const respawned: NpcInstance[] = [];
    const remaining: RespawnEntry[] = [];

    for (const entry of this.respawnQueue) {
      if (now >= entry.respawnAt) {
        const room = getRoom(entry.roomId);
        if (room) {
          const npc = this.spawnNpc(entry.definitionId, room);
          if (npc) respawned.push(npc);
        }
      } else {
        remaining.push(entry);
      }
    }

    this.respawnQueue = remaining;
    return respawned;
  }

  getAllDefinitions(): Map<string, NpcDefinition> {
    return this.definitions;
  }

  get definitionCount(): number {
    return this.definitions.size;
  }

  get instanceCount(): number {
    return this.instances.size;
  }

  get pendingRespawns(): number {
    return this.respawnQueue.length;
  }
}
