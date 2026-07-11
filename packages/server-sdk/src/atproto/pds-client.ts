import type { Agent, AtpAgent } from "@atproto/api";

type AnyAgent = Agent | AtpAgent;
import { NSID, type CharacterProfile } from "@realms/lexicons";
import type { ServerIdentity } from "./server-identity.js";

export class PdsClient {
  constructor(private serverIdentity: ServerIdentity) {}

  async loadCharacter(playerAgent: AnyAgent, did: string): Promise<CharacterProfile | null> {
    try {
      const { data } = await playerAgent.com.atproto.repo.getRecord({
        repo: did,
        collection: NSID.CharacterProfile,
        rkey: "self",
      });
      return data.value as unknown as CharacterProfile;
    } catch (err: unknown) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async saveCharacter(
    playerAgent: AnyAgent,
    did: string,
    profile: CharacterProfile,
  ): Promise<void> {
    await playerAgent.com.atproto.repo.putRecord({
      repo: did,
      collection: NSID.CharacterProfile,
      rkey: "self",
      record: {
        $type: NSID.CharacterProfile,
        ...profile,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  async saveQuestProgress(
    playerAgent: AnyAgent,
    did: string,
    questId: string,
    progress: {
      questId: string;
      serverId: string;
      status: string;
      objectives: Record<string, unknown>[];
      acceptedAt: string;
      completedAt?: string;
    },
  ): Promise<void> {
    const rkey = questId.replace(/[^a-zA-Z0-9-]/g, "-");
    await playerAgent.com.atproto.repo.putRecord({
      repo: did,
      collection: NSID.QuestProgress,
      rkey,
      record: {
        $type: NSID.QuestProgress,
        ...progress,
        serverId: this.serverIdentity.did,
      },
    });
  }

  async loadQuestProgress(
    playerAgent: AnyAgent,
    did: string,
  ): Promise<Array<{ questId: string; status: string; objectives: Record<string, unknown>[] }>> {
    try {
      const { data } = await playerAgent.com.atproto.repo.listRecords({
        repo: did,
        collection: NSID.QuestProgress,
        limit: 100,
      });
      return data.records.map(
        (r) =>
          r.value as unknown as {
            questId: string;
            status: string;
            objectives: Record<string, unknown>[];
          },
      );
    } catch (err: unknown) {
      if (isNotFound(err)) return [];
      throw err;
    }
  }
}

function isNotFound(err: unknown): boolean {
  if (err && typeof err === "object") {
    if ("status" in err && (err as { status: number }).status === 404) return true;
    if ("error" in err && (err as { error: string }).error === "RecordNotFound") return true;
    if (
      "message" in err &&
      typeof (err as { message: string }).message === "string" &&
      (err as { message: string }).message.includes("Could not locate record")
    )
      return true;
  }
  return false;
}
