import { describe, expect, test } from "bun:test";
import { Room, QuestManager, CharacterSession } from "@realms/server-sdk";
import { decodeServerMessage } from "@realms/protocol";
import type { ParsedCommand } from "@realms/common";
import type { CharacterProfile, QuestDefinition, RoomRecord } from "@realms/lexicons";
import { handleMovement } from "../src/commands/movement.js";
import type { CommandContext } from "../src/commands/index.js";

/**
 * Integration test for the room-entry wiring behind #62: moving into a room
 * must advance `visit`-type quest objectives and emit a quest_update. Exercises
 * the real handleMovement -> QuestManager.recordVisit -> buildUpdatePayload path
 * with only the external systems (broadcast/bluesky/combat) stubbed out.
 */

function makeProfile(): CharacterProfile {
  return {
    name: "Scout",
    class: "warrior",
    race: "human",
    level: 1,
    experience: 0,
    attributes: { str: 14, dex: 12, con: 13, int: 10, wis: 10, cha: 12 },
    createdAt: new Date().toISOString(),
  };
}

function makeRoom(
  id: string,
  coordinates: { x: number; y: number; z: number },
  exits: RoomRecord["exits"],
): Room {
  return new Room(id, {
    title: id,
    description: "A test room.",
    area: "test-area",
    coordinates,
    exits,
    flags: ["safe"], // safe so movement never triggers the auto-aggro path
  } as RoomRecord);
}

const VISIT_QUEST: QuestDefinition = {
  name: "Scout the North",
  description: "Reach the northern room.",
  giver: "test-area:guide",
  objectives: [
    {
      type: "visit",
      target: "test-area:north",
      description: "Reach the northern room",
      count: 1,
    },
  ],
  ordered: true,
  consumeItems: true,
  repeatable: false,
} as QuestDefinition;

describe("handleMovement visit-quest wiring", () => {
  test("entering a room advances a visit objective and emits quest_update", () => {
    const questManager = new QuestManager();
    questManager.registerDefinition("test-area:scout-north", VISIT_QUEST);

    const session = new CharacterSession("s1", "did:plc:scout", makeProfile(), "test-area:spawn");
    const sent: string[] = [];
    // Minimal socket so CharacterSession.send() flushes to our capture buffer.
    session.ws = { readyState: 1, send: (d: string) => sent.push(d) } as never;

    questManager.acceptQuest(session.characterDid, "test-area:scout-north");
    // Sanity: the visit objective starts incomplete.
    expect(
      questManager.getProgress(session.characterDid, "test-area:scout-north")!.objectives[0].done,
    ).toBe(false);

    const spawn = makeRoom("test-area:spawn", { x: 0, y: 0, z: 0 }, [
      { direction: "north", target: "test-area:north" },
    ]);
    spawn.addPlayer(session.sessionId, session.name);
    const north = makeRoom("test-area:north", { x: 0, y: 1, z: 0 }, []);
    const rooms = new Map<string, Room>([
      [spawn.id, spawn],
      [north.id, north],
    ]);

    const ctx = {
      session,
      world: {
        getRoom: (id: string) => rooms.get(id),
        questManager,
        npcManager: { getAllInRoom: () => [] },
      },
      broadcast: () => {},
      bluesky: { post: () => {} },
      combat: { npcAggro: () => {} },
    } as unknown as CommandContext;

    const cmd: ParsedCommand = { verb: "go", args: ["north"], raw: "go north" };
    handleMovement(cmd, ctx);

    // Player actually moved.
    expect(session.currentRoom).toBe("test-area:north");

    // The visit objective is now complete...
    expect(
      questManager.getProgress(session.characterDid, "test-area:scout-north")!.objectives[0].done,
    ).toBe(true);

    // ...and a quest_update reflecting that was sent to the client.
    const questUpdates = sent
      .map((d) => decodeServerMessage(d))
      .filter((m): m is NonNullable<typeof m> => m?.type === "quest_update");
    expect(questUpdates.length).toBeGreaterThan(0);
    const update = questUpdates.find(
      (m) => (m as { questId: string }).questId === "test-area:scout-north",
    );
    expect(update).toBeDefined();
    expect((update as { objectives: Array<{ done: boolean }> }).objectives[0].done).toBe(true);
  });
});
