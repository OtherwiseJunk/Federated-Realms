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

// ─── Connection ──────────────────────────────────────────────

describe("connection", () => {
  test("receives welcome message on connect", async () => {
    const client = new TestClient("WelcomeTest");
    await client.connect(port);
    const welcome = await client.waitFor("welcome");
    expect(welcome.serverName).toBeTruthy();
    expect(welcome.sessionId).toBeTruthy();
    client.disconnect();
  });

  test("receives initial room state on connect", async () => {
    const client = new TestClient("RoomTest");
    await client.connect(port);
    const room = await client.waitFor("room_state");
    expect(room.room.title).toBe("Town Square");
    expect(room.room.exits.length).toBeGreaterThan(0);
    client.disconnect();
  });

  test("server health endpoint responds", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
  });

  test("server info endpoint responds", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/info`);
    const data = await res.json();
    expect(data.rooms).toBe(17);
  });

  test("server system endpoint returns game system", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/system`);
    const data = (await res.json()) as {
      classes: Record<string, unknown>;
      races: Record<string, unknown>;
    };
    expect(data.classes).toBeDefined();
    expect(data.races).toBeDefined();
  });
});

// ─── Movement ────────────────────────────────────────────────

describe("movement", () => {
  test("move north to tavern", async () => {
    const client = new TestClient("MoveN");
    await client.connect(port);
    await client.waitFor("room_state");

    const room = await client.commandAndWaitRoom("n");
    expect(room.room.title).toBe("The Rusty Tankard");
    client.disconnect();
  });

  test("move east to blacksmith", async () => {
    const client = new TestClient("MoveE");
    await client.connect(port);
    await client.waitFor("room_state");

    const room = await client.commandAndWaitRoom("e");
    expect(room.room.title).toBe("Ironheart's Forge");
    client.disconnect();
  });

  test("cannot move in invalid direction", async () => {
    const client = new TestClient("BadDir");
    await client.connect(port);
    await client.waitFor("room_state");

    client.clearMessages();
    const text = await client.commandAndWait("go northeast");
    expect(text).toContain("no exit");
    client.disconnect();
  });

  test("full path: town -> gate -> crossroads -> dark forest", async () => {
    const client = new TestClient("Explorer");
    await client.connect(port);
    await client.waitFor("room_state");

    let room = await client.commandAndWaitRoom("s");
    expect(room.room.title).toBe("Southern Gate");

    room = await client.commandAndWaitRoom("s");
    expect(room.room.title).toBe("The Crossroads");

    room = await client.commandAndWaitRoom("e");
    expect(room.room.title).toBe("Edge of the Dark Forest");

    client.disconnect();
  });
});

// ─── Look ────────────────────────────────────────────────────

describe("look", () => {
  test("look shows room description", async () => {
    const client = new TestClient("Looker");
    await client.connect(port);
    await client.waitFor("room_state");

    const room = await client.commandAndWaitRoom("look");
    expect(room.room.title).toBe("Town Square");
    expect(room.room.description).toContain("fountain");
    client.disconnect();
  });

  test("look at exit shows exit description", async () => {
    const client = new TestClient("ExitLooker");
    await client.connect(port);
    await client.waitFor("room_state");

    const text = await client.commandAndWait("look north");
    expect(text).toContain("Rusty Tankard");
    client.disconnect();
  });

  test("look at nonexistent target shows error", async () => {
    const client = new TestClient("GhostLooker");
    await client.connect(port);
    await client.waitFor("room_state");

    const text = await client.commandAndWait("look dragon");
    expect(text).toContain("don't see");
    client.disconnect();
  });
});

// ─── Chat ────────────────────────────────────────────────────

describe("chat", () => {
  test("say broadcasts to room", async () => {
    const alice = new TestClient("AliceChat");
    const bob = new TestClient("BobChat");
    await alice.connect(port);
    await bob.connect(port);
    await alice.waitFor("room_state");
    await bob.waitFor("room_state");

    bob.clearMessages();
    alice.command("say Hello Bob!");

    const msg = await bob.waitFor("chat");
    expect(msg.sender).toBe("AliceChat");
    expect(msg.message).toContain("Hello Bob!");
    expect(msg.channel).toBe("room");

    alice.disconnect();
    bob.disconnect();
  });

  test("shout reaches players in different rooms", async () => {
    const alice = new TestClient("AliceShout");
    const bob = new TestClient("BobShout");
    await alice.connect(port);
    await bob.connect(port);
    await alice.waitFor("room_state");
    await bob.waitFor("room_state");

    // Move Bob to a different room
    await bob.commandAndWaitRoom("n");
    bob.clearMessages();

    alice.command("shout HELLO WORLD!");
    const msg = await bob.waitFor("chat");
    expect(msg.sender).toBe("AliceShout");
    expect(msg.message).toContain("HELLO WORLD!");
    expect(msg.channel).toBe("shout");

    alice.disconnect();
    bob.disconnect();
  });

  test("whisper is private", async () => {
    const alice = new TestClient("AliceWhisper");
    const bob = new TestClient("BobWhisper");
    const eve = new TestClient("EveWhisper");
    await alice.connect(port);
    await bob.connect(port);
    await eve.connect(port);
    await alice.waitFor("room_state");
    await bob.waitFor("room_state");
    await eve.waitFor("room_state");

    bob.clearMessages();
    eve.clearMessages();

    alice.command("whisper BobWhisper secret message");

    const msg = await bob.waitFor("chat");
    expect(msg.message).toContain("secret message");
    expect(msg.channel).toBe("whisper");

    // Eve shouldn't receive the whisper
    await eve.tick(300);
    const eveMessages = eve.getMessagesOfType("chat");
    const hasWhisper = eveMessages.some((m) => m.message.includes("secret message"));
    expect(hasWhisper).toBe(false);

    alice.disconnect();
    bob.disconnect();
    eve.disconnect();
  });
});

// ─── Info Commands ───────────────────────────────────────────

describe("info commands", () => {
  test("stats shows character info", async () => {
    const client = new TestClient("StatCheck");
    await client.connect(port);
    await client.waitFor("room_state");

    const text = await client.commandAndWait("stats");
    expect(text).toContain("StatCheck");
    expect(text).toContain("Level 1");
    expect(text).toContain("warrior");
    expect(text).toContain("HP:");
    expect(text).toContain("Attributes:");
    client.disconnect();
  });

  test("who shows online players", async () => {
    const client = new TestClient("WhoCheck");
    await client.connect(port);
    await client.waitFor("room_state");

    const text = await client.commandAndWait("who");
    expect(text).toContain("WhoCheck");
    expect(text).toContain("Town Square");
    client.disconnect();
  });

  test("help shows command list", async () => {
    const client = new TestClient("HelpCheck");
    await client.connect(port);
    await client.waitFor("room_state");

    const text = await client.commandAndWait("help");
    expect(text).toContain("Movement:");
    expect(text).toContain("Items:");
    expect(text).toContain("NPCs:");
    expect(text).toContain("Social:");
    client.disconnect();
  });

  test("unknown command shows error", async () => {
    const client = new TestClient("BadCmd");
    await client.connect(port);
    await client.waitFor("room_state");

    const text = await client.commandAndWait("dance");
    expect(text).toContain("Unknown command");
    client.disconnect();
  });
});

// ─── Multiplayer ─────────────────────────────────────────────

describe("multiplayer", () => {
  test("players see each other enter rooms", async () => {
    const alice = new TestClient("AliceMP");
    const bob = new TestClient("BobMP");
    await alice.connect(port);
    await bob.connect(port);
    await alice.waitFor("room_state");
    await bob.waitFor("room_state");

    // Move Alice north — Bob should see her leave
    bob.clearMessages();
    alice.command("n");

    const leave = await bob.waitFor("entity_leave");
    expect(leave.entity.name).toBe("AliceMP");

    alice.disconnect();
    bob.disconnect();
  });

  test("who command shows multiple players", async () => {
    const alice = new TestClient("AliceWho");
    const bob = new TestClient("BobWho");
    await alice.connect(port);
    await bob.connect(port);
    await alice.waitFor("room_state");
    await bob.waitFor("room_state");
    alice.clearMessages();

    const text = await alice.commandAndWait("who");
    expect(text).toContain("AliceWho");
    expect(text).toContain("BobWho");

    alice.disconnect();
    bob.disconnect();
  });
});

// ─── Map ─────────────────────────────────────────────────────

describe("map", () => {
  test("map shows current room at spawn", async () => {
    const client = new TestClient("MapSpawn");
    await client.connect(port);
    await client.waitFor("room_state");

    const text = await client.commandAndWait("map");
    expect(text).toContain("[@]");
    expect(text).toContain("You are here");
    expect(text).toContain("Town Square");

    client.disconnect();
  });

  test("map reveals visited rooms after movement", async () => {
    const client = new TestClient("MapExplore");
    await client.connect(port);
    await client.waitFor("room_state");

    // Move north to tavern, then back
    await client.commandAndWaitRoom("n");
    await client.commandAndWaitRoom("s");
    client.clearMessages();

    const text = await client.commandAndWait("map");
    expect(text).toContain("[@]"); // current room
    expect(text).toContain("[+]"); // visited room (tavern)
    expect(text).toContain("Town Square");
    expect(text).toContain("The Rusty Tankard");

    client.disconnect();
  });

  test("m alias works for map", async () => {
    const client = new TestClient("MapAlias");
    await client.connect(port);
    await client.waitFor("room_state");

    const text = await client.commandAndWait("m");
    expect(text).toContain("[@]");
    expect(text).toContain("Map");

    client.disconnect();
  });

  test("map shows connections between rooms", async () => {
    const client = new TestClient("MapConnect");
    await client.connect(port);
    await client.waitFor("room_state");

    // Move east and back to get two connected rooms
    await client.commandAndWaitRoom("e");
    await client.commandAndWaitRoom("w");
    client.clearMessages();

    const text = await client.commandAndWait("map");
    // Should have a horizontal connection between square and forge
    expect(text).toContain("[@]-[+]");

    client.disconnect();
  });

  test("map shows vertical exits to other levels", async () => {
    const client = new TestClient("MapVertical");
    await client.connect(port);
    await client.waitFor("room_state");

    // Navigate to tavern (has "up" exit to upper hallway)
    await client.commandAndWaitRoom("n");
    client.clearMessages();

    const text = await client.commandAndWait("map");
    expect(text).toContain("other level");

    client.disconnect();
  });
});
