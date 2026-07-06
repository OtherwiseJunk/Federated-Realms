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

// ─── Merchant / Gold ─────────────────────────────────────────

describe("merchant and gold", () => {
  test("new characters start with gold", async () => {
    const client = new TestClient("GoldStart");
    await client.connect(port);
    const charUpdate = await client.waitFor("character_update");
    expect(charUpdate.gold).toBe(10);
    client.disconnect();
  });

  test("shop command shows merchant wares", async () => {
    const client = new TestClient("ShopTest");
    await client.connect(port);
    await client.waitFor("room_state");

    // Go to tavern where Marta the Barkeep is
    await client.commandAndWaitRoom("n");
    client.clearMessages();

    const text = await client.commandAndWait("shop");
    expect(text).toContain("Marta");
    expect(text).toContain("Loaf of Bread");
    expect(text).toContain("Health Potion");
    expect(text).toContain("gold");

    client.disconnect();
  });

  test("shop command fails without merchant present", async () => {
    const client = new TestClient("ShopNoMerchant");
    await client.connect(port);
    await client.waitFor("room_state");
    client.clearMessages();

    // Town square has no merchant
    const text = await client.commandAndWait("shop");
    expect(text).toContain("no merchant");

    client.disconnect();
  });

  test("buy command purchases item and deducts gold", async () => {
    const client = new TestClient("BuyTest");
    await client.connect(port);
    await client.waitFor("room_state");

    // Go to tavern
    await client.commandAndWaitRoom("n");
    client.clearMessages();

    // Buy bread (costs 2 gold, starts with 10)
    const text = await client.commandAndWait("buy bread");
    expect(text).toContain("buy");
    expect(text).toContain("Loaf of Bread");
    expect(text).toContain("2 gold");

    // Check gold was deducted
    await client.tick(100);
    const charUpdates = client.getMessagesOfType("character_update");
    if (charUpdates.length > 0) {
      const latest = charUpdates[charUpdates.length - 1];
      expect(latest.gold).toBe(8);
    }

    // Check item is in inventory
    const invUpdates = client.getMessagesOfType("inventory_update");
    if (invUpdates.length > 0) {
      const latest = invUpdates[invUpdates.length - 1];
      const hasBread = latest.inventory.some((i) => i.name === "Loaf of Bread");
      expect(hasBread).toBe(true);
    }

    client.disconnect();
  });

  test("buy command fails without enough gold", async () => {
    const client = new TestClient("BuyBroke");
    await client.connect(port);
    await client.waitFor("room_state");

    // Go to blacksmith (rusty sword costs 5, but buy a bunch of stuff first)
    await client.commandAndWaitRoom("e");
    client.clearMessages();

    // Buy wooden shield (8 gold) — should work with 10 gold
    await client.commandAndWait("buy shield");
    client.clearMessages();

    // Buy rusty sword (5 gold) — should fail with only 2 gold left
    const text = await client.commandAndWait("buy sword");
    expect(text).toContain("can't afford");

    client.disconnect();
  });

  test("sell command sells item to merchant", async () => {
    const client = new TestClient("SellTest");
    await client.connect(port);
    await client.waitFor("room_state");

    // Go to tavern, buy bread, then sell it back
    await client.commandAndWaitRoom("n");
    await client.commandAndWait("buy bread");
    client.clearMessages();

    const text = await client.commandAndWait("sell bread");
    expect(text).toContain("sell");
    expect(text).toContain("Loaf of Bread");
    expect(text).toContain("gold");

    client.disconnect();
  });
});

// ─── Quests ──────────────────────────────────────────────────

describe("quests", () => {
  test("quest_log sent on connect", async () => {
    const client = new TestClient("QuestLogTest");
    await client.connect(port);
    const questLog = await client.waitFor("quest_log");
    expect(questLog.quests).toBeDefined();
    expect(Array.isArray(questLog.quests)).toBe(true);
    client.disconnect();
  });

  test("quests shows no active quests initially", async () => {
    const client = new TestClient("QuestEmptyTest");
    await client.connect(port);
    await client.waitFor("quest_log");
    const text = await client.commandAndWait("log");
    expect(text).toMatch(/no active quests/i);
    client.disconnect();
  });

  test("accept wolf trouble from Grimjaw", async () => {
    const client = new TestClient("QuestAcceptTest");
    await client.connect(port);
    await client.waitFor("quest_log");

    // Navigate east to Grimjaw's blacksmith
    await client.commandAndWaitRoom("e");

    const questUpdatePromise = client.waitFor("quest_update");
    await client.commandAndWait("accept wolf trouble");
    const update = await questUpdatePromise;

    expect(update.questName).toBe("Wolf Trouble");
    expect(update.status).toBe("active");
    expect(update.objectives[0].description).toContain("grey wolves");
    client.disconnect();
  });

  test("quest log shows accepted quest", async () => {
    const client = new TestClient("QuestLogShowTest");
    await client.connect(port);
    await client.waitFor("quest_log");

    await client.commandAndWaitRoom("e");
    await client.commandAndWait("accept wolf trouble");

    const logText = await client.commandAndWait("log");
    expect(logText).toContain("Wolf Trouble");
    expect(logText).toContain("Kill grey wolves");
    client.disconnect();
  });

  test("abandon quest removes it from log", async () => {
    const client = new TestClient("QuestAbandonTest");
    await client.connect(port);
    await client.waitFor("quest_log");

    await client.commandAndWaitRoom("e");
    await client.commandAndWait("accept wolf trouble");

    const afterAccept = await client.commandAndWait("log");
    expect(afterAccept).toContain("Wolf Trouble");

    await client.commandAndWait("abandon wolf trouble");
    const afterAbandon = await client.commandAndWait("log");
    expect(afterAbandon).toMatch(/no active quests/i);
    client.disconnect();
  });

  test("quests command near Grimjaw shows available quest", async () => {
    const client = new TestClient("QuestListNpcTest");
    await client.connect(port);
    await client.waitFor("quest_log");

    await client.commandAndWaitRoom("e");
    const text = await client.commandAndWait("quests");
    expect(text).toMatch(/wolf trouble/i);
    client.disconnect();
  });
});
