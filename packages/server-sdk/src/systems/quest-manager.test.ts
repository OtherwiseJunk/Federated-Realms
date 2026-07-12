import { describe, expect, test } from "bun:test";
import { QuestManager } from "./quest-manager.js";
import type { QuestDefinition } from "@realms/lexicons";

const PLAYER = "did:plc:test-player";

function makeQuest(overrides: Partial<QuestDefinition> = {}): QuestDefinition {
  return {
    name: "Test Quest",
    description: "A test quest.",
    giver: "npc-elder",
    objectives: [{ type: "kill", target: "goblin", description: "Kill 3 goblins", count: 3 }],
    ...overrides,
  } as QuestDefinition;
}

describe("QuestManager", () => {
  describe("definitions", () => {
    test("register and retrieve quest definitions", () => {
      const qm = new QuestManager();
      const quest = makeQuest();
      qm.registerDefinition("q1", quest);

      expect(qm.getDefinition("q1")).toBe(quest);
      expect(qm.getDefinition("missing")).toBeUndefined();
      expect(qm.getAllDefinitions().size).toBe(1);
    });
  });

  describe("accept and track quests", () => {
    test("accept creates active progress", () => {
      const qm = new QuestManager();
      qm.registerDefinition("q1", makeQuest());
      const progress = qm.acceptQuest(PLAYER, "q1");

      expect(progress.status).toBe("active");
      expect(progress.questId).toBe("q1");
      expect(progress.objectives).toHaveLength(1);
      expect(progress.objectives[0].current).toBe(0);
      expect(progress.objectives[0].required).toBe(3);
      expect(progress.objectives[0].done).toBe(false);
    });

    test("throws on accepting unknown quest", () => {
      const qm = new QuestManager();
      expect(() => qm.acceptQuest(PLAYER, "missing")).toThrow("Quest not found");
    });

    test("getActiveQuests returns only active quests", () => {
      const qm = new QuestManager();
      qm.registerDefinition("q1", makeQuest());
      qm.registerDefinition("q2", makeQuest({ name: "Quest 2" }));
      qm.acceptQuest(PLAYER, "q1");
      qm.acceptQuest(PLAYER, "q2");
      qm.completeQuest(PLAYER, "q2");

      const active = qm.getActiveQuests(PLAYER);
      expect(active).toHaveLength(1);
      expect(active[0].questId).toBe("q1");
    });

    test("abandon removes quest progress", () => {
      const qm = new QuestManager();
      qm.registerDefinition("q1", makeQuest());
      qm.acceptQuest(PLAYER, "q1");

      expect(qm.abandonQuest(PLAYER, "q1")).toBe(true);
      expect(qm.getProgress(PLAYER, "q1")).toBeUndefined();
      expect(qm.abandonQuest(PLAYER, "q1")).toBe(false);
    });
  });

  describe("objective tracking", () => {
    test("recordKill advances kill objectives", () => {
      const qm = new QuestManager();
      qm.registerDefinition("q1", makeQuest());
      qm.acceptQuest(PLAYER, "q1");

      const updated = qm.recordKill(PLAYER, "goblin");
      expect(updated).toEqual(["q1"]);

      const progress = qm.getProgress(PLAYER, "q1")!;
      expect(progress.objectives[0].current).toBe(1);
      expect(progress.objectives[0].done).toBe(false);
    });

    test("objective completes when count is met", () => {
      const qm = new QuestManager();
      qm.registerDefinition("q1", makeQuest());
      qm.acceptQuest(PLAYER, "q1");

      qm.recordKill(PLAYER, "goblin");
      qm.recordKill(PLAYER, "goblin");
      qm.recordKill(PLAYER, "goblin");

      const progress = qm.getProgress(PLAYER, "q1")!;
      expect(progress.objectives[0].current).toBe(3);
      expect(progress.objectives[0].done).toBe(true);
    });

    test("does not advance past required count", () => {
      const qm = new QuestManager();
      qm.registerDefinition("q1", makeQuest());
      qm.acceptQuest(PLAYER, "q1");

      for (let i = 0; i < 10; i++) qm.recordKill(PLAYER, "goblin");
      expect(qm.getProgress(PLAYER, "q1")!.objectives[0].current).toBe(3);
    });

    test("wrong target does not advance", () => {
      const qm = new QuestManager();
      qm.registerDefinition("q1", makeQuest());
      qm.acceptQuest(PLAYER, "q1");

      qm.recordKill(PLAYER, "wolf");
      expect(qm.getProgress(PLAYER, "q1")!.objectives[0].current).toBe(0);
    });

    test("sequential objectives must complete in order", () => {
      const qm = new QuestManager();
      qm.registerDefinition(
        "q1",
        makeQuest({
          objectives: [
            { type: "kill", target: "goblin", description: "Kill goblin", count: 1 },
            { type: "talk", target: "npc-elder", description: "Report back", count: 1 },
          ],
        } as any),
      );
      qm.acceptQuest(PLAYER, "q1");

      // Talking before killing should not advance
      const talkResult = qm.recordTalk(PLAYER, "npc-elder");
      expect(talkResult).toEqual([]);
      expect(qm.getProgress(PLAYER, "q1")!.objectives[1].current).toBe(0);

      // Complete first objective
      qm.recordKill(PLAYER, "goblin");
      expect(qm.getProgress(PLAYER, "q1")!.objectives[0].done).toBe(true);

      // Now talking should advance
      const talkResult2 = qm.recordTalk(PLAYER, "npc-elder");
      expect(talkResult2).toEqual(["q1"]);
      expect(qm.getProgress(PLAYER, "q1")!.objectives[1].done).toBe(true);
    });

    test("recordCollect tracks count on hand, not accumulated pickups", () => {
      const qm = new QuestManager();
      qm.registerDefinition(
        "q1",
        makeQuest({
          objectives: [
            { type: "collect", target: "herb", description: "Collect 5 herbs", count: 5 },
          ],
        } as any),
      );
      qm.acceptQuest(PLAYER, "q1");

      qm.recordCollect(PLAYER, "herb", 3);
      expect(qm.getProgress(PLAYER, "q1")!.objectives[0].current).toBe(3);

      // Drop + re-take: still only 3 on hand — progress must not double-count
      expect(qm.recordCollect(PLAYER, "herb", 3)).toEqual([]);
      expect(qm.getProgress(PLAYER, "q1")!.objectives[0].current).toBe(3);

      qm.recordCollect(PLAYER, "herb", 5);
      expect(qm.getProgress(PLAYER, "q1")!.objectives[0].current).toBe(5);
      expect(qm.getProgress(PLAYER, "q1")!.objectives[0].done).toBe(true);
    });

    test("recordCollect caps at required even with more on hand", () => {
      const qm = new QuestManager();
      qm.registerDefinition(
        "q1",
        makeQuest({
          objectives: [
            { type: "collect", target: "herb", description: "Collect 5 herbs", count: 5 },
          ],
        } as any),
      );
      qm.acceptQuest(PLAYER, "q1");

      qm.recordCollect(PLAYER, "herb", 99);
      expect(qm.getProgress(PLAYER, "q1")!.objectives[0].current).toBe(5);
      expect(qm.getProgress(PLAYER, "q1")!.objectives[0].done).toBe(true);
    });

    test("acceptQuest syncs collect objectives from items already on hand", () => {
      const qm = new QuestManager();
      qm.registerDefinition(
        "q1",
        makeQuest({
          objectives: [
            { type: "collect", target: "herb", description: "Collect 5 herbs", count: 5 },
          ],
        } as any),
      );

      qm.acceptQuest(PLAYER, "q1", (itemDefId) => (itemDefId === "herb" ? 2 : 0));
      expect(qm.getProgress(PLAYER, "q1")!.objectives[0].current).toBe(2);
    });

    test("turn-in requires collect items still on hand", () => {
      const qm = new QuestManager();
      qm.registerDefinition(
        "q1",
        makeQuest({
          objectives: [
            { type: "collect", target: "herb", description: "Collect 2 herbs", count: 2 },
          ],
        } as any),
      );
      qm.acceptQuest(PLAYER, "q1");
      qm.recordCollect(PLAYER, "herb", 2);
      expect(qm.getProgress(PLAYER, "q1")!.objectives[0].done).toBe(true);

      // Player dropped the herbs after the objective completed
      expect(qm.getCompletableQuests(PLAYER, "npc-elder", () => 0)).toHaveLength(0);

      // With the herbs back on hand, turn-in is allowed again
      expect(qm.getCompletableQuests(PLAYER, "npc-elder", () => 2)).toHaveLength(1);

      // Without an inventory lookup, behavior is unchanged
      expect(qm.getCompletableQuests(PLAYER, "npc-elder")).toHaveLength(1);
    });

    test("completeQuest consumes collect items by default", () => {
      const qm = new QuestManager();
      qm.registerDefinition(
        "q1",
        makeQuest({
          objectives: [
            { type: "collect", target: "herb", description: "Collect 2 herbs", count: 2 },
            { type: "talk", target: "npc-elder", description: "Report back", count: 1 },
          ],
        } as any),
      );
      qm.acceptQuest(PLAYER, "q1");
      const consumed: Array<[string, number]> = [];

      qm.completeQuest(PLAYER, "q1", (itemDefId, count) => consumed.push([itemDefId, count]));

      expect(consumed).toEqual([["herb", 2]]);
    });

    test("completeQuest with consumeItems false leaves inventory alone", () => {
      const qm = new QuestManager();
      qm.registerDefinition(
        "q1",
        makeQuest({
          consumeItems: false,
          objectives: [
            { type: "collect", target: "herb", description: "Collect 2 herbs", count: 2 },
          ],
        } as any),
      );
      qm.acceptQuest(PLAYER, "q1");
      const consumed: Array<[string, number]> = [];

      qm.completeQuest(PLAYER, "q1", (itemDefId, count) => consumed.push([itemDefId, count]));

      expect(consumed).toEqual([]);
    });

    test("acceptQuest inventory sync respects objective order", () => {
      const qm = new QuestManager();
      qm.registerDefinition(
        "q1",
        makeQuest({
          objectives: [
            { type: "kill", target: "goblin", description: "Kill goblin", count: 1 },
            { type: "collect", target: "herb", description: "Collect 5 herbs", count: 5 },
          ],
        } as any),
      );

      qm.acceptQuest(PLAYER, "q1", () => 5);
      expect(qm.getProgress(PLAYER, "q1")!.objectives[1].current).toBe(0);
    });

    test("recordVisit tracks room visits", () => {
      const qm = new QuestManager();
      qm.registerDefinition(
        "q1",
        makeQuest({
          objectives: [
            {
              type: "visit",
              target: "dark-forest:clearing",
              description: "Visit the clearing",
              count: 1,
            },
          ],
        } as any),
      );
      qm.acceptQuest(PLAYER, "q1");

      const updated = qm.recordVisit(PLAYER, "dark-forest:clearing");
      expect(updated).toEqual(["q1"]);
      expect(qm.getProgress(PLAYER, "q1")!.objectives[0].done).toBe(true);
    });
  });

  describe("completion", () => {
    test("completeQuest marks as completed", () => {
      const qm = new QuestManager();
      qm.registerDefinition("q1", makeQuest());
      qm.acceptQuest(PLAYER, "q1");

      const def = qm.completeQuest(PLAYER, "q1");
      expect(def?.name).toBe("Test Quest");

      const progress = qm.getProgress(PLAYER, "q1")!;
      expect(progress.status).toBe("completed");
      expect(progress.completedAt).toBeDefined();
    });

    test("hasCompleted returns true after completion", () => {
      const qm = new QuestManager();
      qm.registerDefinition("q1", makeQuest());
      qm.acceptQuest(PLAYER, "q1");

      expect(qm.hasCompleted(PLAYER, "q1")).toBe(false);
      qm.completeQuest(PLAYER, "q1");
      expect(qm.hasCompleted(PLAYER, "q1")).toBe(true);
    });
  });

  describe("availability", () => {
    test("getAvailableQuests filters by giver", () => {
      const qm = new QuestManager();
      qm.registerDefinition("q1", makeQuest({ giver: "npc-elder" }));
      qm.registerDefinition("q2", makeQuest({ giver: "npc-blacksmith" }));

      const available = qm.getAvailableQuests(PLAYER, "npc-elder", 1);
      expect(available).toHaveLength(1);
      expect(available[0].questId).toBe("q1");
    });

    test("excludes already active quests", () => {
      const qm = new QuestManager();
      qm.registerDefinition("q1", makeQuest());
      qm.acceptQuest(PLAYER, "q1");

      expect(qm.getAvailableQuests(PLAYER, "npc-elder", 1)).toHaveLength(0);
    });

    test("excludes completed non-repeatable quests", () => {
      const qm = new QuestManager();
      qm.registerDefinition("q1", makeQuest());
      qm.acceptQuest(PLAYER, "q1");
      qm.completeQuest(PLAYER, "q1");

      expect(qm.getAvailableQuests(PLAYER, "npc-elder", 1)).toHaveLength(0);
    });

    test("includes completed repeatable quests", () => {
      const qm = new QuestManager();
      qm.registerDefinition("q1", makeQuest({ repeatable: true }));
      qm.acceptQuest(PLAYER, "q1");
      qm.completeQuest(PLAYER, "q1");

      expect(qm.getAvailableQuests(PLAYER, "npc-elder", 1)).toHaveLength(1);
    });

    test("respects level requirements", () => {
      const qm = new QuestManager();
      qm.registerDefinition("q1", makeQuest({ level: 5 }));

      expect(qm.getAvailableQuests(PLAYER, "npc-elder", 3)).toHaveLength(0);
      expect(qm.getAvailableQuests(PLAYER, "npc-elder", 5)).toHaveLength(1);
    });

    test("respects prerequisites", () => {
      const qm = new QuestManager();
      qm.registerDefinition("q1", makeQuest());
      qm.registerDefinition("q2", makeQuest({ prerequisites: ["q1"], name: "Sequel" }));

      // q2 not available until q1 complete
      expect(qm.getAvailableQuests(PLAYER, "npc-elder", 1).map((q) => q.questId)).toEqual(["q1"]);

      qm.acceptQuest(PLAYER, "q1");
      qm.completeQuest(PLAYER, "q1");

      const available = qm.getAvailableQuests(PLAYER, "npc-elder", 1);
      expect(available.map((q) => q.questId)).toEqual(["q2"]);
    });
  });

  describe("completable quests", () => {
    test("returns quests with all objectives done at the right NPC", () => {
      const qm = new QuestManager();
      qm.registerDefinition(
        "q1",
        makeQuest({
          objectives: [{ type: "kill", target: "goblin", description: "Kill goblin", count: 1 }],
        } as any),
      );
      qm.acceptQuest(PLAYER, "q1");

      // Not completable yet
      expect(qm.getCompletableQuests(PLAYER, "npc-elder")).toHaveLength(0);

      qm.recordKill(PLAYER, "goblin");
      const completable = qm.getCompletableQuests(PLAYER, "npc-elder");
      expect(completable).toHaveLength(1);
      expect(completable[0].questId).toBe("q1");
    });

    test("uses turnIn NPC when specified", () => {
      const qm = new QuestManager();
      qm.registerDefinition(
        "q1",
        makeQuest({
          giver: "npc-elder",
          turnIn: "npc-blacksmith",
          objectives: [{ type: "kill", target: "goblin", description: "Kill goblin", count: 1 }],
        } as any),
      );
      qm.acceptQuest(PLAYER, "q1");
      qm.recordKill(PLAYER, "goblin");

      expect(qm.getCompletableQuests(PLAYER, "npc-elder")).toHaveLength(0);
      expect(qm.getCompletableQuests(PLAYER, "npc-blacksmith")).toHaveLength(1);
    });
  });

  describe("payloads", () => {
    test("buildUpdatePayload returns quest state", () => {
      const qm = new QuestManager();
      qm.registerDefinition("q1", makeQuest());
      qm.acceptQuest(PLAYER, "q1");
      qm.recordKill(PLAYER, "goblin");

      const payload = qm.buildUpdatePayload(PLAYER, "q1");
      expect(payload).not.toBeNull();
      expect(payload!.type).toBe("quest_update");
      expect(payload!.questName).toBe("Test Quest");
      expect(payload!.objectives[0].current).toBe(1);
      expect(payload!.objectives[0].required).toBe(3);
    });

    test("buildLogPayload returns all active quests", () => {
      const qm = new QuestManager();
      qm.registerDefinition("q1", makeQuest());
      qm.registerDefinition("q2", makeQuest({ name: "Quest 2" }));
      qm.acceptQuest(PLAYER, "q1");
      qm.acceptQuest(PLAYER, "q2");

      const payload = qm.buildLogPayload(PLAYER);
      expect(payload.type).toBe("quest_log");
      expect(payload.quests).toHaveLength(2);
    });

    test("buildUpdatePayload returns null for unknown quest", () => {
      const qm = new QuestManager();
      expect(qm.buildUpdatePayload(PLAYER, "missing")).toBeNull();
    });
  });
});
