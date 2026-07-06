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

// ─── Tell Command ───────────────────────────────────────────

describe("tell", () => {
  test("tell delivers message to local player", async () => {
    const alice = new TestClient("AliceTell");
    const bob = new TestClient("BobTell");
    await alice.connect(port);
    await bob.connect(port);
    await alice.waitFor("room_state");
    await bob.waitFor("room_state");

    bob.clearMessages();
    alice.command("tell BobTell hey there!");

    const msg = await bob.waitFor("chat");
    expect(msg.sender).toBe("AliceTell");
    expect(msg.message).toBe("hey there!");
    expect(msg.channel).toBe("tell");

    alice.disconnect();
    bob.disconnect();
  });

  test("tell works across different rooms", async () => {
    const alice = new TestClient("AliceFar");
    const bob = new TestClient("BobFar");
    await alice.connect(port);
    await bob.connect(port);
    await alice.waitFor("room_state");
    await bob.waitFor("room_state");

    // Move Bob to a different room
    await bob.commandAndWaitRoom("n");
    bob.clearMessages();

    alice.command("tell BobFar distant message");

    const msg = await bob.waitFor("chat");
    expect(msg.sender).toBe("AliceFar");
    expect(msg.message).toBe("distant message");
    expect(msg.channel).toBe("tell");

    alice.disconnect();
    bob.disconnect();
  });

  test("sender gets confirmation narrative", async () => {
    const alice = new TestClient("AliceConf");
    const bob = new TestClient("BobConf");
    await alice.connect(port);
    await bob.connect(port);
    await alice.waitFor("room_state");
    await bob.waitFor("room_state");

    alice.clearMessages();
    const text = await alice.commandAndWait("tell BobConf hello friend");
    expect(text).toContain("You tell BobConf");
    expect(text).toContain("hello friend");

    alice.disconnect();
    bob.disconnect();
  });

  test("tell is private — third party does not receive", async () => {
    const alice = new TestClient("AlicePriv");
    const bob = new TestClient("BobPriv");
    const eve = new TestClient("EvePriv");
    await alice.connect(port);
    await bob.connect(port);
    await eve.connect(port);
    await alice.waitFor("room_state");
    await bob.waitFor("room_state");
    await eve.waitFor("room_state");

    bob.clearMessages();
    eve.clearMessages();

    alice.command("tell BobPriv secret tell");

    await bob.waitFor("chat");

    // Eve should not have received it
    await eve.tick(300);
    const eveChats = eve.getMessagesOfType("chat");
    const leaked = eveChats.some((m) => m.message.includes("secret tell"));
    expect(leaked).toBe(false);

    alice.disconnect();
    bob.disconnect();
    eve.disconnect();
  });

  test("tell to self shows error", async () => {
    const alice = new TestClient("AliceSelf");
    await alice.connect(port);
    await alice.waitFor("room_state");

    const text = await alice.commandAndWait("tell AliceSelf hi me");
    expect(text).toContain("Talking to yourself");

    alice.disconnect();
  });

  test("tell to offline player shows not found", async () => {
    const alice = new TestClient("AliceLonely");
    await alice.connect(port);
    await alice.waitFor("room_state");

    const text = await alice.commandAndWait("tell NobodyHere hello");
    expect(text).toContain("not online");

    alice.disconnect();
  });

  test("tell with no args shows usage", async () => {
    const alice = new TestClient("AliceUsage");
    await alice.connect(port);
    await alice.waitFor("room_state");

    const text = await alice.commandAndWait("tell");
    expect(text).toContain("Usage");

    alice.disconnect();
  });

  test("tell with no message shows usage", async () => {
    const alice = new TestClient("AliceNoMsg");
    await alice.connect(port);
    await alice.waitFor("room_state");

    const text = await alice.commandAndWait("tell SomePlayer");
    expect(text).toContain("Usage");

    alice.disconnect();
  });

  test("msg alias works for tell", async () => {
    const alice = new TestClient("AliceAlias");
    const bob = new TestClient("BobAlias");
    await alice.connect(port);
    await bob.connect(port);
    await alice.waitFor("room_state");
    await bob.waitFor("room_state");

    bob.clearMessages();
    alice.command("msg BobAlias alias test");

    const msg = await bob.waitFor("chat");
    expect(msg.sender).toBe("AliceAlias");
    expect(msg.message).toBe("alias test");
    expect(msg.channel).toBe("tell");

    alice.disconnect();
    bob.disconnect();
  });

  test("tell works during combat", async () => {
    const alice = new TestClient("AliceCombat");
    const bob = new TestClient("BobCombat");
    await alice.connect(port);
    await bob.connect(port);
    await alice.waitFor("room_state");
    await bob.waitFor("room_state");

    // Navigate Alice to forest path (wolf auto-aggros)
    await alice.commandAndWaitRoom("s"); // gate
    await alice.commandAndWaitRoom("s"); // crossroads
    await alice.commandAndWaitRoom("e"); // forest edge
    await alice.commandAndWaitRoom("e"); // forest path
    await alice.tick(300); // wait for aggro

    // Try telling Bob during combat
    bob.clearMessages();
    alice.command("tell BobCombat help me!");

    const msg = await bob.waitFor("chat");
    expect(msg.message).toBe("help me!");

    alice.disconnect();
    bob.disconnect();
  });
});
