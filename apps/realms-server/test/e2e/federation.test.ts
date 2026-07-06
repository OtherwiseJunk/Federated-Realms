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

// ─── Portals ─────────────────────────────────────────────────

describe("portals", () => {
  test("portal chamber room is reachable", async () => {
    const client = new TestClient("PortalExplorer");
    await client.connect(port);
    await client.waitFor("room_state");

    // Town Square -> South Gate -> Crossroads -> Old Road -> Portal Chamber
    await client.commandAndWaitRoom("s"); // gate
    await client.commandAndWaitRoom("s"); // crossroads
    await client.commandAndWaitRoom("w"); // old road
    const room = await client.commandAndWaitRoom("w"); // portal chamber

    expect(room.room.title).toBe("The Portal Chamber");
    expect(room.room.description).toContain("portal");
    expect(room.room.description).toContain("Federated Realms");
    expect(room.room.flags).toContain("safe");
    client.disconnect();
  });

  test("portal chamber has exit back to old road", async () => {
    const client = new TestClient("PortalExit");
    await client.connect(port);
    await client.waitFor("room_state");

    await client.commandAndWaitRoom("s");
    await client.commandAndWaitRoom("s");
    await client.commandAndWaitRoom("w");
    const room = await client.commandAndWaitRoom("w");

    const eastExit = room.room.exits.find((e: { direction: string }) => e.direction === "east");
    expect(eastExit).toBeDefined();

    // Go back east
    const back = await client.commandAndWaitRoom("e");
    expect(back.room.title).toBe("The Old Road");
    client.disconnect();
  });
});

// ─── XRPC: Chat Locate Player ─────────────────────────────

describe("XRPC chat.locatePlayer", () => {
  test("returns found=true for online player", async () => {
    const client = new TestClient("LocateOnline");
    await client.connect(port);
    await client.waitFor("room_state");

    const res = await fetch(
      `http://127.0.0.1:${port}/xrpc/com.cacheblasters.realms.chat.locatePlayer?name=LocateOnline`,
    );
    expect(res.ok).toBe(true);
    const data = (await res.json()) as { found: boolean };
    expect(data.found).toBe(true);

    client.disconnect();
  });

  test("returns found=false for offline player", async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/xrpc/com.cacheblasters.realms.chat.locatePlayer?name=NobodyOnline`,
    );
    expect(res.ok).toBe(true);
    const data = (await res.json()) as { found: boolean };
    expect(data.found).toBe(false);
  });

  test("returns found=false when name param is missing", async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/xrpc/com.cacheblasters.realms.chat.locatePlayer`,
    );
    expect(res.ok).toBe(true);
    const data = (await res.json()) as { found: boolean };
    expect(data.found).toBe(false);
  });

  test("case-insensitive name matching", async () => {
    const client = new TestClient("CaseTest");
    await client.connect(port);
    await client.waitFor("room_state");

    const res = await fetch(
      `http://127.0.0.1:${port}/xrpc/com.cacheblasters.realms.chat.locatePlayer?name=casetest`,
    );
    expect(res.ok).toBe(true);
    const data = (await res.json()) as { found: boolean };
    expect(data.found).toBe(true);

    client.disconnect();
  });
});

// ─── XRPC: Chat Relay ────────────────────────────────────

describe("XRPC chat.relay", () => {
  test("delivers relayed tell to online player", async () => {
    const bob = new TestClient("RelayBob");
    await bob.connect(port);
    await bob.waitFor("room_state");
    bob.clearMessages();

    const res = await fetch(`http://127.0.0.1:${port}/xrpc/com.cacheblasters.realms.chat.relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderName: "RemoteAlice",
        senderDid: "did:plc:remotealice",
        recipientName: "RelayBob",
        message: "Hello from another server!",
        sourceServer: "did:plc:remoteserver",
      }),
    });

    expect(res.ok).toBe(true);
    const data = (await res.json()) as { delivered: boolean };
    expect(data.delivered).toBe(true);

    // Bob should receive the tell
    const msg = await bob.waitFor("chat");
    expect(msg.sender).toBe("RemoteAlice");
    expect(msg.message).toBe("Hello from another server!");
    expect(msg.channel).toBe("tell");

    bob.disconnect();
  });

  test("returns delivered=false for offline player", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/xrpc/com.cacheblasters.realms.chat.relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderName: "RemoteAlice",
        senderDid: "did:plc:remotealice",
        recipientName: "NobodyHereRelay",
        message: "Hello?",
        sourceServer: "did:plc:remoteserver",
      }),
    });

    expect(res.ok).toBe(true);
    const data = (await res.json()) as { delivered: boolean };
    expect(data.delivered).toBe(false);
  });

  test("rejects relay with missing fields", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/xrpc/com.cacheblasters.realms.chat.relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderName: "Alice" }),
    });

    expect(res.status).toBe(400);
  });

  test("relay uses case-insensitive name matching", async () => {
    const bob = new TestClient("RelayCaseBob");
    await bob.connect(port);
    await bob.waitFor("room_state");
    bob.clearMessages();

    const res = await fetch(`http://127.0.0.1:${port}/xrpc/com.cacheblasters.realms.chat.relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderName: "RemoteSender",
        senderDid: "did:plc:remotesender",
        recipientName: "relaycasebob",
        message: "case insensitive test",
        sourceServer: "did:plc:remoteserver",
      }),
    });

    expect(res.ok).toBe(true);
    const data = (await res.json()) as { delivered: boolean };
    expect(data.delivered).toBe(true);

    const msg = await bob.waitFor("chat");
    expect(msg.message).toBe("case insensitive test");

    bob.disconnect();
  });
});

// ─── Server Info & Discovery ─────────────────────────────

describe("server discovery endpoints", () => {
  test("info endpoint returns server metadata", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/info`);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.name).toBeTruthy();
    expect(data.rooms).toBeDefined();
    expect(data.players).toBeDefined();
  });

  test("system endpoint returns game system", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/system`);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.classes).toBeDefined();
    expect(data.races).toBeDefined();
    expect(data.attributes).toBeDefined();
  });

  test("health endpoint returns ok", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as { status: string };
    expect(data.status).toBe("ok");
  });
});
