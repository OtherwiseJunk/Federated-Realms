#!/usr/bin/env bun
/**
 * Federated Realms — Interactive Demo
 *
 * Starts the server, connects a hero, and plays through an adventure
 * with full narrative output including combat. Run with:
 *
 *   bun run test/demo.ts
 */

import { TestClient, startServer, stopServer } from "./helpers.ts";

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function step(label: string) {
  console.log(`\n${BOLD}${CYAN}── ${label} ${"─".repeat(Math.max(0, 60 - label.length))}${RESET}`);
}

function narrate(text: string) {
  for (const line of text.split("\n")) {
    console.log(`  ${GREEN}${line}${RESET}`);
  }
}

function combat(text: string) {
  for (const line of text.split("\n")) {
    console.log(`  ${RED}${line}${RESET}`);
  }
}

function room(title: string, desc: string, extras: string[] = []) {
  console.log(`\n  ${BOLD}${CYAN}${title}${RESET}`);
  console.log(`  ${DIM}${desc.slice(0, 120)}...${RESET}`);
  for (const e of extras) {
    console.log(`  ${YELLOW}${e}${RESET}`);
  }
}

function cmd(input: string) {
  console.log(`  ${DIM}> ${input}${RESET}`);
}

async function main() {
  console.log(`\n${BOLD}${CYAN}⚔️  Federated Realms — Adventure Demo${RESET}\n`);
  console.log(`${DIM}Starting server...${RESET}`);

  const server = await startServer();
  console.log(`${DIM}Server running on port ${server.port}${RESET}`);

  const hero = new TestClient("Kaelith");

  try {
    await hero.connect(server.port, { classId: "rogue", raceId: "elf" });

    // ── Welcome ──
    step("Arriving in the Realm");
    const welcome = await hero.waitFor("welcome");
    console.log(`  Connected to ${BOLD}${welcome.serverName}${RESET}`);

    const spawn = await hero.waitFor("room_state");
    room(spawn.room.title, spawn.room.description, [
      `Items: ${spawn.room.items.map((i) => `${i.name}${i.quantity > 1 ? ` (x${i.quantity})` : ""}`).join(", ") || "none"}`,
      `Exits: ${spawn.room.exits.map((e) => e.direction).join(", ")}`,
    ]);

    // ── Stats ──
    step("Checking Character Stats");
    cmd("stats");
    narrate(await hero.commandAndWait("stats"));

    // ── Blacksmith ──
    step("Visiting the Blacksmith");
    cmd("east");
    let r = await hero.commandAndWaitRoom("e");
    room(r.room.title, r.room.description, [
      `NPCs: ${r.room.npcs.map((n) => n.name).join(", ")}`,
      `Items: ${r.room.items.map((i) => i.name).join(", ")}`,
    ]);

    cmd("look grimjaw");
    narrate(await hero.commandAndWait("look grimjaw"));

    cmd("talk grimjaw");
    narrate(await hero.commandAndWait("talk grimjaw"));

    // ── Gear Up ──
    step("Picking Up and Equipping Gear");
    cmd("take rusty sword");
    narrate(await hero.commandAndWait("take rusty sword"));
    await hero.waitFor("inventory_update");

    cmd("take wooden shield");
    narrate(await hero.commandAndWait("take wooden shield"));
    await hero.waitFor("inventory_update");

    cmd("equip rusty sword");
    narrate(await hero.commandAndWait("equip rusty sword"));

    cmd("equip wooden shield");
    narrate(await hero.commandAndWait("equip wooden shield"));

    cmd("equipment");
    narrate(await hero.commandAndWait("eq"));

    cmd("examine rusty sword");
    narrate(await hero.commandAndWait("ex rusty sword"));

    // ── Tavern ──
    step("Stopping at the Tavern");
    cmd("west");
    await hero.commandAndWaitRoom("w");
    cmd("north");
    r = await hero.commandAndWaitRoom("n");
    room(r.room.title, r.room.description, [
      `NPCs: ${r.room.npcs.map((n) => n.name).join(", ")}`,
      `Items: ${r.room.items.map((i) => `${i.name}${i.quantity > 1 ? ` (x${i.quantity})` : ""}`).join(", ")}`,
    ]);

    cmd("talk marta");
    narrate(await hero.commandAndWait("talk marta"));

    cmd("talk marta rumors");
    narrate(await hero.commandAndWait("talk marta rumors"));

    cmd("take bread");
    narrate(await hero.commandAndWait("take bread"));
    await hero.waitFor("inventory_update");

    // ── Journey South ──
    step("Heading to the Dark Forest");
    cmd("south → south → south");
    await hero.commandAndWaitRoom("s");
    await hero.commandAndWaitRoom("s");

    r = await hero.commandAndWaitRoom("s");
    room(r.room.title, r.room.description, [
      `Exits: ${r.room.exits.map((e) => e.direction).join(", ")}`,
    ]);

    // ── Dark Forest ──
    step("Entering the Dark Forest");
    cmd("east");
    r = await hero.commandAndWaitRoom("e");
    room(r.room.title, r.room.description, [
      `Items: ${r.room.items.map((i) => i.name).join(", ")}`,
    ]);

    cmd("take gnarled staff");
    narrate(await hero.commandAndWait("take staff"));
    await hero.waitFor("inventory_update");

    // ── Forest Path — First Combat ──
    step("Encountering the Grey Wolf");
    cmd("east");
    r = await hero.commandAndWaitRoom("e");
    room(r.room.title, r.room.description, [`NPCs: ${r.room.npcs.map((n) => n.name).join(", ")}`]);

    cmd("attack wolf");
    let combatText = await hero.commandAndWait("attack wolf");
    combat(combatText);

    // Fight until wolf dies or hero falls
    let wolfSlain = false;
    for (let i = 0; i < 20; i++) {
      if (combatText.includes("slain")) {
        wolfSlain = true;
        break;
      }
      if (combatText.includes("defeated")) {
        break;
      }
      cmd("attack");
      combatText = await hero.commandAndWait("attack");
      combat(combatText);
    }

    if (wolfSlain) {
      console.log(`  ${BOLD}${GREEN}The Grey Wolf has been defeated!${RESET}`);
    } else {
      console.log(`  ${BOLD}${RED}Kaelith was defeated... but awakes at the town square.${RESET}`);
      // Navigate back if needed
      await hero.commandAndWaitRoom("s");
      await hero.commandAndWaitRoom("s");
      await hero.commandAndWaitRoom("e");
      await hero.commandAndWaitRoom("e");
    }

    // ── Mushroom Grove ──
    step("Discovering the Mushroom Grove");
    cmd("north");
    r = await hero.commandAndWaitRoom("n");
    room(r.room.title, r.room.description, [
      `NPCs: ${r.room.npcs.map((n) => n.name).join(", ")}`,
      `Items: ${r.room.items.map((i) => `${i.name}${i.quantity > 1 ? ` (x${i.quantity})` : ""}`).join(", ")}`,
      `Flags: ${r.room.flags.join(", ")}`,
    ]);

    cmd("look morel");
    narrate(await hero.commandAndWait("look morel"));

    cmd("talk morel");
    narrate(await hero.commandAndWait("talk morel"));

    cmd("talk morel mushrooms");
    narrate(await hero.commandAndWait("talk morel mushrooms"));

    cmd("take mushroom");
    narrate(await hero.commandAndWait("take mushroom"));
    await hero.waitFor("inventory_update");

    // ── Use a consumable ──
    step("Using a Healing Item");
    cmd("use mushroom");
    narrate(await hero.commandAndWait("use mushroom"));

    // ── Spider Hollow — Boss Fight ──
    step("Venturing to Spider Hollow");
    cmd("south → east → east");
    await hero.commandAndWaitRoom("s");
    await hero.commandAndWaitRoom("e");

    r = await hero.commandAndWaitRoom("e");
    room(r.room.title, r.room.description, [
      `NPCs: ${r.room.npcs.map((n) => n.name).join(", ")}`,
      `Items: ${r.room.items.map((i) => `${i.name}${i.quantity > 1 ? ` (x${i.quantity})` : ""}`).join(", ")}`,
      `Flags: ${r.room.flags.join(", ")}`,
    ]);

    step("Fighting the Forest Spider");
    cmd("attack spider");
    combatText = await hero.commandAndWait("attack spider");
    combat(combatText);

    let spiderSlain = false;
    for (let i = 0; i < 20; i++) {
      if (combatText.includes("slain")) {
        spiderSlain = true;
        break;
      }
      if (combatText.includes("defeated")) {
        break;
      }
      cmd("attack");
      combatText = await hero.commandAndWait("attack");
      combat(combatText);
    }

    if (spiderSlain) {
      console.log(`  ${BOLD}${GREEN}The Forest Spider has been defeated!${RESET}`);
    }

    // ── Final Status ──
    step("Final Character Status");
    cmd("stats");
    narrate(await hero.commandAndWait("stats"));

    cmd("inventory");
    narrate(await hero.commandAndWait("i"));

    cmd("equipment");
    narrate(await hero.commandAndWait("eq"));

    // ── Who ──
    step("Who's Online?");
    cmd("who");
    narrate(await hero.commandAndWait("who"));

    // ── Done ──
    step("Adventure Complete!");
    console.log(
      `  ${BOLD}${GREEN}Kaelith the elf rogue has explored the realm and fought monsters!${RESET}`,
    );
    console.log(`  ${DIM}Visited: Town Square, Blacksmith, Tavern, Gate, Crossroads,`);
    console.log(`  Forest Edge, Forest Path, Mushroom Grove, Spider Hollow${RESET}`);

    hero.disconnect();
  } catch (err) {
    console.error(`\n${BOLD}\x1b[31mDemo failed:${RESET}`, err);
    hero.disconnect();
  } finally {
    stopServer(server.process);
    console.log(`\n${DIM}Server stopped.${RESET}\n`);
  }
}

main();
