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

// ─── Full Adventure (Demo Scenario) ─────────────────────────

describe("full adventure walkthrough", () => {
  test("a hero explores the world, gears up, and ventures into the forest", async () => {
    const hero = new TestClient("Kaelith");
    await hero.connect(port, { classId: "rogue", raceId: "elf" });

    // 1. Arrive in town square
    const welcome = await hero.waitFor("welcome");
    expect(welcome.serverName).toBeTruthy();

    const spawn = await hero.waitFor("room_state");
    expect(spawn.room.title).toBe("Town Square");

    // 2. Check stats
    let text = await hero.commandAndWait("stats");
    expect(text).toContain("Kaelith");
    expect(text).toContain("elf");
    expect(text).toContain("rogue");

    // 3. Visit the blacksmith
    let room = await hero.commandAndWaitRoom("e");
    expect(room.room.title).toBe("Ironheart's Forge");
    expect(room.room.npcs.some((n) => n.name.includes("Grimjaw"))).toBe(true);

    // 4. Talk to Grimjaw
    text = await hero.commandAndWait("talk grimjaw");
    expect(text).toContain("blades, shields, and armor");

    // 5. Buy gear from Grimjaw's shop
    text = await hero.commandAndWait("shop");
    expect(text).toContain("Rusty Sword");

    text = await hero.commandAndWait("buy rusty sword");
    expect(text).toContain("buy");
    await hero.waitFor("inventory_update");

    // 6. Check inventory
    text = await hero.commandAndWait("i");
    expect(text).toContain("Rusty Sword");

    // 7. Examine the sword
    text = await hero.commandAndWait("ex rusty sword");
    expect(text).toContain("weapon");
    expect(text).toContain("melee");

    // 8. Head back and visit the tavern
    room = await hero.commandAndWaitRoom("w");
    expect(room.room.title).toBe("Town Square");

    room = await hero.commandAndWaitRoom("n");
    expect(room.room.title).toBe("The Rusty Tankard");

    // 9. Talk to Marta about rumors
    text = await hero.commandAndWait("talk marta rumors");
    expect(text).toContain("Dark Forest");
    expect(text).toContain("Grimjaw");

    // 10. Buy bread for the journey
    text = await hero.commandAndWait("buy bread");
    expect(text).toContain("buy");
    await hero.waitFor("inventory_update");

    // 11. Head south through town to the crossroads
    room = await hero.commandAndWaitRoom("s"); // back to square
    room = await hero.commandAndWaitRoom("s"); // gate
    expect(room.room.npcs.some((n) => n.name.includes("Guard"))).toBe(true);

    room = await hero.commandAndWaitRoom("s"); // crossroads
    expect(room.room.title).toBe("The Crossroads");

    // 12. Enter the Dark Forest
    room = await hero.commandAndWaitRoom("e"); // forest edge
    expect(room.room.title).toBe("Edge of the Dark Forest");
    expect(room.room.items.some((i) => i.name.includes("Staff"))).toBe(true);

    // 13. Take the gnarled staff
    text = await hero.commandAndWait("take staff");
    expect(text).toContain("Gnarled Staff");
    await hero.waitFor("inventory_update");

    // 14. Push deeper into the forest (wolf may or may not be here — previous tests may have killed it)
    room = await hero.commandAndWaitRoom("e"); // forest path

    // Flee from auto-aggro'd wolf if present
    await hero.tick(200);
    for (let i = 0; i < 20; i++) {
      hero.clearMessages();
      const fleeText = await hero.commandAndWait("flee");
      if (fleeText.includes("escape") || fleeText.includes("not in combat")) break;
      if (fleeText.includes("defeated")) break;
    }

    // 15. Visit the mushroom grove
    room = await hero.commandAndWaitRoom("n"); // mushroom grove
    expect(room.room.title).toBe("Luminous Mushroom Grove");
    expect(room.room.flags).toContain("safe");

    // 16. Talk to Old Morel
    text = await hero.commandAndWait("talk morel");
    expect(text).toContain("mushrooms");

    text = await hero.commandAndWait("talk morel mushrooms");
    expect(text).toContain("Luminaris caps");
    expect(text).toContain("healing");

    // 17. Gather mushrooms
    text = await hero.commandAndWait("take mushroom");
    expect(text).toContain("Glowing Mushroom");
    await hero.waitFor("inventory_update");

    // 18. Final inventory check
    text = await hero.commandAndWait("i");
    expect(text).toContain("Rusty Sword");
    expect(text).toContain("Loaf of Bread");
    expect(text).toContain("Gnarled Staff");
    expect(text).toContain("Glowing Mushroom");

    // 19. Help command works everywhere
    text = await hero.commandAndWait("help");
    expect(text).toContain("Movement:");

    hero.disconnect();
  });
});
