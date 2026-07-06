import type { RoomRecord, Direction, RoomExit } from "@realms/lexicons";
import type { RoomState, RoomFeature, EntityBrief, ItemInstance } from "@realms/common";
import { findExit, hasFlag } from "@realms/common";

export class Room {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly area: string;
  readonly coordinates: { x: number; y: number; z: number };
  readonly exits: RoomExit[];
  readonly flags: string[];
  readonly features: RoomFeature[];

  private players = new Map<string, EntityBrief>();
  private npcs = new Map<string, EntityBrief>();
  private groundItems: ItemInstance[] = [];

  constructor(id: string, record: RoomRecord, features?: RoomFeature[]) {
    this.id = id;
    this.title = record.title;
    this.description = record.description;
    this.area = record.area;
    this.coordinates = record.coordinates;
    this.exits = record.exits ?? [];
    this.flags = record.flags ?? [];
    this.features = features ?? [];
  }

  addPlayer(id: string, name: string): void {
    this.players.set(id, { id, name, type: "player" });
  }

  removePlayer(id: string): EntityBrief | undefined {
    const player = this.players.get(id);
    this.players.delete(id);
    return player;
  }

  hasPlayer(id: string): boolean {
    return this.players.has(id);
  }

  getPlayerIds(): string[] {
    return [...this.players.keys()];
  }

  addNpc(id: string, name: string): void {
    this.npcs.set(id, { id, name, type: "npc" });
  }

  removeNpc(id: string): EntityBrief | undefined {
    const npc = this.npcs.get(id);
    this.npcs.delete(id);
    return npc;
  }

  getNpcIds(): string[] {
    return [...this.npcs.keys()];
  }

  addGroundItem(item: ItemInstance, stackable: boolean = false): void {
    if (stackable) {
      const existing = this.groundItems.find((i) => i.definitionId === item.definitionId);
      if (existing) {
        existing.quantity += item.quantity;
        return;
      }
    }
    this.groundItems.push(item);
  }

  removeGroundItem(identifier: string, quantity: number = 1): ItemInstance | undefined {
    let index = this.groundItems.findIndex((i) => i.instanceId === identifier);
    if (index === -1) {
      const lower = identifier.toLowerCase();
      index = this.groundItems.findIndex((i) => i.name.toLowerCase().includes(lower));
    }
    if (index === -1) return undefined;

    const item = this.groundItems[index];
    if (quantity >= item.quantity) {
      this.groundItems.splice(index, 1);
      return item;
    }

    item.quantity -= quantity;
    return {
      instanceId: item.instanceId,
      definitionId: item.definitionId,
      name: item.name,
      quantity,
      properties: item.properties,
    };
  }

  findGroundItem(identifier: string): ItemInstance | undefined {
    const lower = identifier.toLowerCase();
    return this.groundItems.find(
      (i) => i.instanceId === identifier || i.name.toLowerCase().includes(lower),
    );
  }

  getGroundItems(): ItemInstance[] {
    return this.groundItems;
  }

  getExit(direction: Direction): RoomExit | undefined {
    return findExit(this.toState(), direction);
  }

  isSafe(): boolean {
    return hasFlag(this.toState(), "safe");
  }

  findFeature(keyword: string): RoomFeature | undefined {
    const lower = keyword.toLowerCase();
    return this.features.find((f) =>
      f.keywords.some((k) => k.includes(lower) || lower.includes(k)),
    );
  }

  toState(): RoomState {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      area: this.area,
      coordinates: this.coordinates,
      exits: this.exits,
      flags: this.flags,
      players: [...this.players.values()],
      npcs: [...this.npcs.values()],
      items: this.groundItems.map((i) => ({
        id: i.instanceId,
        name: i.name,
        quantity: i.quantity,
      })),
      features: this.features.length > 0 ? this.features : undefined,
    };
  }
}
