import { describe, expect, test } from "bun:test";
import { Room } from "./room.js";
import type { RoomRecord, ItemDefinition } from "@realms/lexicons";

const swordDef: ItemDefinition = {
  name: "Iron Sword",
  type: "weapon",
  description: "A sword.",
  stackable: false,
  maxStack: 1,
};

const potionDef: ItemDefinition = {
  name: "Health Potion",
  type: "consumable",
  description: "Heals.",
  stackable: true,
  maxStack: 10,
};

function makeRoom(overrides: Partial<RoomRecord> = {}): Room {
  const record: RoomRecord = {
    title: "Test Room",
    description: "A test room.",
    area: "test-area",
    coordinates: { x: 0, y: 0, z: 0 },
    exits: [{ direction: "north" as any, target: "test-area:other-room" }],
    flags: ["safe"],
    ...overrides,
  };
  return new Room("test-area:test-room", record);
}

describe("Room", () => {
  describe("construction", () => {
    test("stores room metadata", () => {
      const room = makeRoom();
      expect(room.id).toBe("test-area:test-room");
      expect(room.title).toBe("Test Room");
      expect(room.description).toBe("A test room.");
      expect(room.area).toBe("test-area");
      expect(room.coordinates).toEqual({ x: 0, y: 0, z: 0 });
    });

    test("defaults exits and flags to empty arrays", () => {
      const room = makeRoom({ exits: undefined, flags: undefined });
      expect(room.exits).toEqual([]);
      expect(room.flags).toEqual([]);
    });
  });

  describe("player management", () => {
    test("add and remove players", () => {
      const room = makeRoom();
      room.addPlayer("p1", "Alice");
      room.addPlayer("p2", "Bob");

      expect(room.hasPlayer("p1")).toBe(true);
      expect(room.hasPlayer("p3")).toBe(false);
      expect(room.getPlayerIds()).toEqual(["p1", "p2"]);

      const removed = room.removePlayer("p1");
      expect(removed?.name).toBe("Alice");
      expect(room.hasPlayer("p1")).toBe(false);
    });

    test("removing nonexistent player returns undefined", () => {
      const room = makeRoom();
      expect(room.removePlayer("nobody")).toBeUndefined();
    });
  });

  describe("NPC management", () => {
    test("add and remove NPCs", () => {
      const room = makeRoom();
      room.addNpc("n1", "Goblin");
      expect(room.getNpcIds()).toEqual(["n1"]);

      const removed = room.removeNpc("n1");
      expect(removed?.name).toBe("Goblin");
      expect(room.getNpcIds()).toEqual([]);
    });
  });

  describe("ground items", () => {
    const sword = {
      instanceId: "i1",
      definitionId: "area:sword",
      name: "Iron Sword",
      quantity: 1,
      properties: {},
    };

    const potion = {
      instanceId: "i2",
      definitionId: "area:potion",
      name: "Health Potion",
      quantity: 3,
      properties: {},
    };

    test("add and find items", () => {
      const room = makeRoom();
      room.addGroundItem({ ...sword }, swordDef);
      expect(room.findGroundItem("Iron Sword")?.name).toBe("Iron Sword");
      expect(room.findGroundItem("sword")?.name).toBe("Iron Sword");
      expect(room.findGroundItem("i1")?.instanceId).toBe("i1");
      expect(room.findGroundItem("missing")).toBeUndefined();
    });

    test("stackable items merge quantities", () => {
      const room = makeRoom();
      room.addGroundItem({ ...potion }, potionDef);
      room.addGroundItem({ ...potion, instanceId: "i3", quantity: 2 }, potionDef);

      const items = room.getGroundItems();
      expect(items).toHaveLength(1);
      expect(items[0].quantity).toBe(5);
    });

    test("non-stackable items stay separate", () => {
      const room = makeRoom();
      room.addGroundItem({ ...sword }, swordDef);
      room.addGroundItem({ ...sword, instanceId: "i3" }, swordDef);
      expect(room.getGroundItems()).toHaveLength(2);
    });

    test("remove full stack", () => {
      const room = makeRoom();
      room.addGroundItem({ ...potion }, potionDef);
      const removed = room.removeGroundItem("Health Potion", 5);
      expect(removed?.quantity).toBe(3);
      expect(room.getGroundItems()).toHaveLength(0);
    });

    test("remove partial stack mints a fresh instance with independent properties", () => {
      const room = makeRoom();
      room.addGroundItem({ ...potion, properties: { charges: 2 } }, potionDef);
      const removed = room.removeGroundItem("Health Potion", 1);

      expect(removed?.quantity).toBe(1);
      expect(room.getGroundItems()[0].quantity).toBe(2);
      expect(removed?.instanceId).not.toBe("i2");

      (removed!.properties as { charges: number }).charges = 99;
      expect(room.getGroundItems()[0].properties).toEqual({ charges: 2 });
    });

    test("remove nonexistent item returns undefined", () => {
      const room = makeRoom();
      expect(room.removeGroundItem("missing")).toBeUndefined();
    });
  });

  describe("exits and flags", () => {
    test("getExit finds by direction", () => {
      const room = makeRoom();
      expect(room.getExit("north")).toBeDefined();
      expect(room.getExit("south")).toBeUndefined();
    });

    test("isSafe checks for safe flag", () => {
      expect(makeRoom({ flags: ["safe"] }).isSafe()).toBe(true);
      expect(makeRoom({ flags: [] }).isSafe()).toBe(false);
    });
  });

  describe("toState", () => {
    test("serializes complete room state", () => {
      const room = makeRoom();
      room.addPlayer("p1", "Alice");
      room.addNpc("n1", "Guard");
      room.addGroundItem(
        {
          instanceId: "i1",
          definitionId: "area:torch",
          name: "Torch",
          quantity: 2,
          properties: {},
        },
        swordDef,
      );

      const state = room.toState();
      expect(state.id).toBe("test-area:test-room");
      expect(state.players).toHaveLength(1);
      expect(state.players[0].name).toBe("Alice");
      expect(state.npcs).toHaveLength(1);
      expect(state.npcs[0].name).toBe("Guard");
      expect(state.items).toHaveLength(1);
      expect(state.items[0]).toEqual({ id: "i1", name: "Torch", quantity: 2 });
    });
  });
});
