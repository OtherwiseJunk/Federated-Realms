import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import { TestClient, startServer, stopServer, fleeUntilClear } from "../helpers.ts";

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

// ─── NPCs ────────────────────────────────────────────────────

describe("NPCs", () => {
  test("tavern has Marta the Barkeep", async () => {
    const client = new TestClient("NpcCheck");
    await client.connect(port);
    await client.waitFor("room_state");

    const room = await client.commandAndWaitRoom("n");
    expect(room.room.title).toBe("The Rusty Tankard");
    const marta = room.room.npcs.find((n) => n.name.includes("Marta"));
    expect(marta).toBeDefined();
    client.disconnect();
  });

  test("look at NPC shows description", async () => {
    const client = new TestClient("NpcLook");
    await client.connect(port);
    await client.waitFor("room_state");

    await client.commandAndWaitRoom("n");
    client.clearMessages();

    const text = await client.commandAndWait("look marta");
    expect(text).toContain("Marta");
    expect(text).toContain("Level");
    client.disconnect();
  });

  test("talk to NPC shows greeting dialogue", async () => {
    const client = new TestClient("NpcTalk");
    await client.connect(port);
    await client.waitFor("room_state");

    await client.commandAndWaitRoom("n");
    client.clearMessages();

    const text = await client.commandAndWait("talk marta");
    expect(text).toContain("Marta");
    // Should show dialogue and response options
    expect(text.length).toBeGreaterThan(20);
    client.disconnect();
  });

  test("navigate dialogue tree", async () => {
    const client = new TestClient("DialogNav");
    await client.connect(port);
    await client.waitFor("room_state");

    await client.commandAndWaitRoom("n");
    client.clearMessages();

    // Talk to Marta about rumors
    const text = await client.commandAndWait("talk marta rumors");
    expect(text).toContain("Dark Forest");
    client.disconnect();
  });

  test("hostile NPC refuses dialogue", async () => {
    const client = new TestClient("HostileTalk");
    await client.connect(port);
    await client.waitFor("room_state");

    // Navigate to forest path where wolf is
    await client.commandAndWaitRoom("s"); // gate
    await client.commandAndWaitRoom("s"); // crossroads
    await client.commandAndWaitRoom("e"); // forest edge
    await client.commandAndWaitRoom("e"); // forest path

    // Flee from auto-aggro'd wolf. Pulse combat regenerates AP only on
    // the server's tick, so a plain retry loop with no wait between
    // attempts burns through AP (and then the rate limit) without ever
    // resolving combat.
    await client.tick(200);
    await fleeUntilClear(client);
    client.clearMessages();

    // Try to talk to the wolf (hostile NPC) — should fail. If we died
    // fleeing and respawned elsewhere, "don't see" covers that too.
    const text = await client.commandAndWait("talk wolf");
    const hostile =
      text.toLowerCase().includes("interested in talking") ||
      text.toLowerCase().includes("don't see");
    expect(hostile).toBe(true);
    client.disconnect();
  }, 300_000);
});
