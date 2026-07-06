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
  ): Array<{ questId: string; def: QuestDefinition; progress: ActiveQuestState }> {
    const active = this.getActiveQuests(characterDid);
    return active.filter(({ def, progress }) => {
      const turnInNpc = def.turnIn ?? def.giver;
      if (turnInNpc !== npcDefId) return false;
      return progress.objectives.every((o) => o.done);
    });
  }

  acceptQuest(characterDid: string, questId: string): ActiveQuestState {
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

  /** Complete a quest, return the definition for reward processing */
  completeQuest(characterDid: string, questId: string): QuestDefinition | null {
    const prog = this.getProgress(characterDid, questId);
    const def = this.definitions.get(questId);
    if (!prog || !def) return null;
    prog.status = "completed";
    prog.completedAt = new Date().toISOString();
    return def;
  }

  /** Record a kill. Returns questIds whose progress changed. */
  recordKill(characterDid: string, npcDefId: string): string[] {
    return this.recordEvent(characterDid, "kill", npcDefId);
  }

  /** Record item collection. Returns questIds whose progress changed. */
  recordCollect(characterDid: string, itemDefId: string, count: number = 1): string[] {
    return this.recordEvent(characterDid, "collect", itemDefId, count);
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

        // Only advance if previous objectives are done (or this is first)
        const prevDone = i === 0 || progress.objectives.slice(0, i).every((p) => p.done);
        if (!prevDone) continue;

        prog.current = Math.min(prog.current + count, prog.required);
        if (prog.current >= prog.required) {
          prog.done = true;
        }
        changed = true;
        break; // Only advance one objective at a time
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
