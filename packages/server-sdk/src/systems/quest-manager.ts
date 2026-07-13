import type { QuestDefinition } from "@realms/lexicons";

interface QuestObjectiveProgress {
  current: number;
  required: number;
  done: boolean;
}

export interface ActiveQuestState {
  questId: string;
  serverId: string;
  status: "active" | "completed" | "failed";
  objectives: QuestObjectiveProgress[];
  acceptedAt: string;
  completedAt?: string;
}

export class QuestManager {
  private definitions = new Map<string, QuestDefinition>();
  // characterDid -> questId -> progress
  private progress = new Map<string, Map<string, ActiveQuestState>>();

  registerDefinition(id: string, def: QuestDefinition): void {
    this.definitions.set(id, def);
  }

  getDefinition(id: string): QuestDefinition | undefined {
    return this.definitions.get(id);
  }

  getAllDefinitions(): Map<string, QuestDefinition> {
    return this.definitions;
  }

  getProgress(characterDid: string, questId: string): ActiveQuestState | undefined {
    return this.progress.get(characterDid)?.get(questId);
  }

  getActiveQuests(
    characterDid: string,
  ): Array<{ questId: string; def: QuestDefinition; progress: ActiveQuestState }> {
    const playerProgress = this.progress.get(characterDid);
    if (!playerProgress) return [];
    const result = [];
    for (const [questId, prog] of playerProgress.entries()) {
      if (prog.status === "active") {
        const def = this.definitions.get(questId);
        if (def) result.push({ questId, def, progress: prog });
      }
    }
    return result;
  }

  hasCompleted(characterDid: string, questId: string): boolean {
    return this.progress.get(characterDid)?.get(questId)?.status === "completed";
  }

  /** Get quests this NPC offers that the player can accept */
  getAvailableQuests(
    characterDid: string,
    npcDefId: string,
    playerLevel: number,
  ): Array<{ questId: string; def: QuestDefinition }> {
    const result = [];
    for (const [questId, def] of this.definitions.entries()) {
      if (def.giver !== npcDefId) continue;

      // Skip if already active or completed (unless repeatable)
      const existing = this.getProgress(characterDid, questId);
      if (existing?.status === "active") continue;
      if (existing?.status === "completed" && !def.repeatable) continue;

      // Check level requirement
      if (def.level && playerLevel < def.level) continue;

      // Check prerequisites
      const prereqsMet = (def.prerequisites ?? []).every((prereqId) =>
        this.hasCompleted(characterDid, prereqId),
      );
      if (!prereqsMet) continue;

      result.push({ questId, def });
    }
    return result;
  }

  /** Get active quests the player can turn in at this NPC, where all objectives are done */
  getCompletableQuests(
    characterDid: string,
    npcDefId: string,
    countOnHand?: (itemDefId: string) => number,
  ): Array<{ questId: string; def: QuestDefinition; progress: ActiveQuestState }> {
    const active = this.getActiveQuests(characterDid);
    return active.filter(({ def, progress }) => {
      const turnInNpc = def.turnIn ?? def.giver;
      if (turnInNpc !== npcDefId) return false;
      if (!progress.objectives.every((o) => o.done)) return false;
      // A collect objective marked done can go stale if the player later
      // dropped or sold the items — re-verify possession at turn-in
      if (countOnHand) {
        for (let i = 0; i < def.objectives.length; i++) {
          const obj = def.objectives[i];
          if (obj.type !== "collect" || !obj.target) continue;
          if (countOnHand(obj.target) < (progress.objectives[i]?.required ?? obj.count ?? 1)) {
            return false;
          }
        }
      }
      return true;
    });
  }

  acceptQuest(
    characterDid: string,
    questId: string,
    countOnHand?: (itemDefId: string) => number,
  ): ActiveQuestState {
    const def = this.definitions.get(questId);
    if (!def) throw new Error(`Quest not found: ${questId}`);

    const progress: ActiveQuestState = {
      questId,
      serverId: "local",
      status: "active",
      objectives: def.objectives.map((obj) => ({
        current: 0,
        required: obj.count ?? 1,
        done: false,
      })),
      acceptedAt: new Date().toISOString(),
    };

    // Credit collect objectives for items already in inventory
    if (countOnHand) {
      for (let i = 0; i < def.objectives.length; i++) {
        if (def.ordered && i > 0 && !progress.objectives[i - 1].done) break;
        const obj = def.objectives[i];
        if (obj.type !== "collect" || !obj.target) continue;
        const prog = progress.objectives[i];
        prog.current = Math.min(countOnHand(obj.target), prog.required);
        prog.done = prog.current >= prog.required;
      }
    }

    let playerProgress = this.progress.get(characterDid);
    if (!playerProgress) {
      playerProgress = new Map();
      this.progress.set(characterDid, playerProgress);
    }
    playerProgress.set(questId, progress);
    return progress;
  }

  abandonQuest(characterDid: string, questId: string): boolean {
    return this.progress.get(characterDid)?.delete(questId) ?? false;
  }

  /**
   * Complete a quest, return the definition for reward processing.
   * Unless the definition sets `consumeItems: false`, `consume` is invoked
   * for each collect objective so the caller can remove the turned-in items.
   */
  completeQuest(
    characterDid: string,
    questId: string,
    consume?: (itemDefId: string, count: number) => void,
  ): QuestDefinition | null {
    const prog = this.getProgress(characterDid, questId);
    const def = this.definitions.get(questId);
    if (!prog || !def) return null;
    prog.status = "completed";
    prog.completedAt = new Date().toISOString();
    if (consume && def.consumeItems !== false) {
      for (const obj of def.objectives) {
        if (obj.type === "collect" && obj.target) {
          consume(obj.target, obj.count ?? 1);
        }
      }
    }
    return def;
  }

  /** Record a kill. Returns questIds whose progress changed. */
  recordKill(characterDid: string, npcDefId: string): string[] {
    return this.recordEvent(characterDid, "kill", npcDefId);
  }

  /**
   * Record item collection. `countOnHand` is the player's total inventory
   * count for the item (possession model), not a pickup delta — dropping and
   * re-taking an item must not accumulate progress.
   * Returns questIds whose progress changed.
   */
  recordCollect(characterDid: string, itemDefId: string, countOnHand: number = 1): string[] {
    return this.recordEvent(characterDid, "collect", itemDefId, countOnHand);
  }

  /** Record talking to an NPC. Returns questIds whose progress changed. */
  recordTalk(characterDid: string, npcDefId: string): string[] {
    return this.recordEvent(characterDid, "talk", npcDefId);
  }

  /** Record visiting a room. Returns questIds whose progress changed. */
  recordVisit(characterDid: string, roomId: string): string[] {
    return this.recordEvent(characterDid, "visit", roomId);
  }

  private recordEvent(
    characterDid: string,
    type: string,
    targetId: string,
    count: number = 1,
  ): string[] {
    const active = this.getActiveQuests(characterDid);
    const updated: string[] = [];

    for (const { questId, def, progress } of active) {
      let changed = false;

      for (let i = 0; i < def.objectives.length; i++) {
        const obj = def.objectives[i];
        const prog = progress.objectives[i];

        if (!prog || prog.done) continue;
        if (obj.type !== type) continue;
        if (obj.target && obj.target !== targetId) continue;

        // Ordered quests only advance an objective once all previous ones are done
        const prevDone =
          !def.ordered || i === 0 || progress.objectives.slice(0, i).every((p) => p.done);
        if (!prevDone) continue;

        // Collect objectives mirror what's on hand; other types accumulate events
        const next =
          type === "collect"
            ? Math.min(count, prog.required)
            : Math.min(prog.current + count, prog.required);
        if (next <= prog.current) continue;
        prog.current = next;
        if (prog.current >= prog.required) {
          prog.done = true;
        }
        changed = true;
        // Ordered quests advance one objective per event; unordered credit every match
        if (def.ordered) break;
      }

      if (changed) updated.push(questId);
    }

    return updated;
  }

  /** Build a quest_update payload for sending to the client */
  buildUpdatePayload(characterDid: string, questId: string, includeRewards = false) {
    const prog = this.getProgress(characterDid, questId);
    const def = this.definitions.get(questId);
    if (!prog || !def) return null;

    return {
      type: "quest_update" as const,
      questId,
      questName: def.name,
      status: prog.status,
      objectives: def.objectives.map((obj, i) => ({
        description: obj.description,
        current: prog.objectives[i]?.current ?? 0,
        required: obj.count ?? 1,
        done: prog.objectives[i]?.done ?? false,
      })),
      ...(includeRewards && def.rewards ? { rewards: def.rewards } : {}),
    };
  }

  /** Build quest_log payload */
  buildLogPayload(characterDid: string) {
    const active = this.getActiveQuests(characterDid);
    return {
      type: "quest_log" as const,
      quests: active.map(({ questId, def, progress }) => ({
        questId,
        questName: def.name,
        status: progress.status,
        objectives: def.objectives.map((obj, i) => ({
          description: obj.description,
          current: progress.objectives[i]?.current ?? 0,
          required: obj.count ?? 1,
          done: progress.objectives[i]?.done ?? false,
        })),
      })),
    };
  }
}
