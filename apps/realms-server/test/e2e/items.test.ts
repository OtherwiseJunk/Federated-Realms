import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import { TestClient, startServer, stopServer } from "../helpers.ts";

let port: number;
let serverProc: Subprocess;

beforeAll(async () => {
  const server = await startServer();
  port = server.port;
  serverProc = server.process;
});

afterAll(() => {
  stopServer(serverProc);
});

// ─── Items ───────────────────────────────────────────────────

describe("items", () => {
  test("stackable items spawn as a single stack", async () => {
    const client = new TestClient("StackCheck");
    await client.connect(port);
    await client.waitFor("room_state");

    // Navigate to mushroom grove where glowing mushrooms spawn (stackable)
    await client.commandAndWaitRoom("s"); // gate
    await client.commandAndWaitRoom("s"); // crossroads
    await client.commandAndWaitRoom("e"); // forest edge
    await client.commandAndWaitRoom("e"); // forest path

    // Flee from auto-aggro'd wolf if present
    await client.tick(200);
    for (let i = 0; i < 20; i++) {
      client.clearMessages();
      const fleeText = await client.commandAndWait("flee");
      if (fleeText.includes("escape") || fleeText.includes("not in combat")) break;
      if (fleeText.includes("defeated")) break;
    }

    const room = await client.commandAndWaitRoom("n"); // mushroom grove

    // Glowing Mushrooms should appear as one stack (quantity 4)
    const mushrooms = room.room.items.filter((i) => i.name === "Glowing Mushroom");
    expect(mushrooms.length).toBe(1);
    expect(mushrooms[0].quantity).toBeGreaterThan(1);
    client.disconnect();
  });

  test("non-stackable items spawn as separate instances", async () => {
    const client = new TestClient("NonStack");
    await client.connect(port);
    await client.waitFor("room_state");

    // Navigate to forest edge — Gnarled Staff is non-stackable, spawns quantity 2
    await client.commandAndWaitRoom("s");
    await client.commandAndWaitRoom("s");
    const room = await client.commandAndWaitRoom("e");

    const staffs = room.room.items.filter((i) => i.name.includes("Staff"));
    // 2 separate non-stackable staff instances
    expect(staffs.length).toBe(2);
    for (const s of staffs) {
      expect(s.quantity).toBe(1);
    }
    client.disconnect();
  });

  test("take an item", async () => {
    const client = new TestClient("Taker");
    await client.connect(port);
    await client.waitFor("room_state");

    // Navigate to forest edge
    await client.commandAndWaitRoom("s");
    await client.commandAndWaitRoom("s");
    await client.commandAndWaitRoom("e");
    client.clearMessages();

    const text = await client.commandAndWait("take staff");
    expect(text).toContain("Gnarled Staff");
    expect(text).toContain("pick up");

    const inv = await client.waitFor("inventory_update");
    expect(inv.inventory.some((i) => i.name === "Gnarled Staff")).toBe(true);
    client.disconnect();
  });

  test("inventory shows carried items", async () => {
    const client = new TestClient("InvCheck");
    await client.connect(port);
    await client.waitFor("room_state");

    // Buy an item from shop instead of relying on ground items
    await client.commandAndWaitRoom("n"); // tavern
    await client.commandAndWait("buy bread");
    await client.waitFor("inventory_update");
    client.clearMessages();

    const text = await client.commandAndWait("i");
    expect(text).toContain("Loaf of Bread");
    client.disconnect();
  });

  test("drop an item", async () => {
    const client = new TestClient("Dropper");
    await client.connect(port);
    await client.waitFor("room_state");

    // Buy an item from shop
    await client.commandAndWaitRoom("n"); // tavern
    await client.commandAndWait("buy bread");
    await client.waitFor("inventory_update");
    client.clearMessages();

    const text = await client.commandAndWait("drop bread");
    expect(text).toContain("drop");
    expect(text).toContain("Loaf of Bread");

    // Room should now have the bread
    const room = await client.commandAndWaitRoom("look");
    expect(room.room.items.some((i) => i.name.includes("Bread"))).toBe(true);
    client.disconnect();
  });

  test("examine an item shows details", async () => {
    const client = new TestClient("Examiner");
    await client.connect(port);
    await client.waitFor("room_state");

    // Buy a weapon from blacksmith
    await client.commandAndWaitRoom("e"); // blacksmith
    await client.commandAndWait("buy rusty sword");
    await client.waitFor("inventory_update");
    client.clearMessages();

    const text = await client.commandAndWait("ex rusty sword");
    expect(text).toContain("Rusty Sword");
    expect(text).toContain("weapon");
    expect(text).toContain("melee");
    client.disconnect();
  });

  test("cannot take item that doesn't exist", async () => {
    const client = new TestClient("GhostTaker");
    await client.connect(port);
    await client.waitFor("room_state");

    const text = await client.commandAndWait("take excalibur");
    expect(text).toContain("don't see");
    client.disconnect();
  });
});

// ─── Equipment ──────────────────────────────────────────────

describe("equipment", () => {
  test("equip a weapon from the shop", async () => {
    const client = new TestClient("Equipper");
    await client.connect(port);
    await client.waitFor("room_state");

    // Go to blacksmith and buy an iron dagger
    await client.commandAndWaitRoom("e"); // blacksmith
    await client.commandAndWait("buy iron dagger");
    await client.waitFor("inventory_update");
    client.clearMessages();

    // Equip it
    const text = await client.commandAndWait("equip iron dagger");
    expect(text).toContain("equip");
    expect(text).toContain("Iron Dagger");
    expect(text).toContain("Main Hand");
    client.disconnect();
  });

  test("show equipment and unequip", async () => {
    const client = new TestClient("EqShow");
    await client.connect(port);
    await client.waitFor("room_state");

    // Check empty equipment
    client.clearMessages();
    let text = await client.commandAndWait("eq");
    expect(text).toContain("Main Hand: —");

    // Go to blacksmith and buy leather cap (head armor, level 1)
    await client.commandAndWaitRoom("e");
    await client.commandAndWait("buy leather cap");
    await client.waitFor("inventory_update");
    client.clearMessages();

    await client.commandAndWait("equip leather cap");
    client.clearMessages();

    text = await client.commandAndWait("eq");
    expect(text).toContain("Head: Leather Cap");
    expect(text).toContain("defense: 1");

    // Unequip
    client.clearMessages();
    text = await client.commandAndWait("unequip head");
    expect(text).toContain("unequip");
    expect(text).toContain("Leather Cap");

    // Should be back in inventory
    text = await client.commandAndWait("i");
    expect(text).toContain("Leather Cap");
    client.disconnect();
  });
});

// ─── Use Items ──────────────────────────────────────────────

describe("use items", () => {
  test("use consumable outside combat", async () => {
    const client = new TestClient("Healer");
    await client.connect(port);
    await client.waitFor("room_state");

    // Buy bread from tavern
    await client.commandAndWaitRoom("n"); // tavern
    await client.commandAndWait("buy bread");
    await client.waitFor("inventory_update");
    client.clearMessages();

    // Use it
    const text = await client.commandAndWait("use bread");
    expect(text).toContain("Loaf of Bread");
    expect(text).toContain("HP:");
    client.disconnect();
  });
});
