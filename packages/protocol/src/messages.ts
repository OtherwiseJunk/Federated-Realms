import type { RoomState, EntityBrief, ItemInstance } from "@realms/common";

// ── Shared combat types ──

export interface CombatantInfo {
  id: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  description?: string;
  art?: string[];
}

// ── Shared adaptation types ──

export interface AdaptationOption {
  id: string;
  name: string;
  description: string;
}

export interface AdaptationRequired {
  class?: { original: string; options: AdaptationOption[] };
  race?: { original: string; options: AdaptationOption[] };
}

// Client -> Server messages
export type ClientMessage =
  | { type: "command"; id: string; command: string; args: string[] }
  | { type: "move"; id: string; direction: string }
  | { type: "chat"; channel: string; message: string }
  | { type: "interact"; id: string; targetId: string; action: string }
  | { type: "adaptation_response"; classId?: string; raceId?: string }
  | { type: "ping" };

// Server -> Client messages
export type ServerMessage =
  | { type: "room_state"; room: RoomState }
  | { type: "narrative"; text: string; style?: "info" | "error" | "combat" | "system" | "chat" }
  | { type: "entity_enter"; entity: EntityBrief; room: string }
  | { type: "entity_leave"; entity: EntityBrief; room: string; direction?: string }
  | { type: "chat"; channel: string; sender: string; message: string }
  | { type: "error"; code: string; message: string }
  | { type: "ack"; id: string }
  | { type: "pong"; serverTime: number }
  | { type: "welcome"; sessionId: string; serverName: string }
  | { type: "inventory_update"; inventory: ItemInstance[] }
  | { type: "equipment_update"; equipment: Record<string, ItemInstance> }
  | {
      type: "character_update";
      hp: number;
      maxHp: number;
      mp: number;
      maxMp: number;
      ap: number;
      maxAp: number;
      gold: number;
      level: number;
      xp: number;
      xpToNext: number;
    }
  | { type: "combat_start"; target: string; combatants: CombatantInfo[] }
  | { type: "combat_update"; combatants: CombatantInfo[]; targetId: string }
  | { type: "combat_end"; reason: "victory" | "flee" | "death" }
  | { type: "level_up"; level: number; message: string }
  | { type: "map_update"; grid: string[]; cursorRow: number; cursorCol: number; legend: string[] }
  | {
      type: "quest_update";
      questId: string;
      questName: string;
      status: "active" | "completed" | "failed";
      objectives: { description: string; current: number; required: number; done: boolean }[];
      rewards?: { xp?: number; gold?: number; items?: string[] };
    }
  | {
      type: "quest_log";
      quests: Array<{
        questId: string;
        questName: string;
        status: "active" | "completed" | "failed";
        objectives: { description: string; current: number; required: number; done: boolean }[];
      }>;
    }
  | {
      type: "portal_offer";
      targetServer: { name: string; did: string; endpoint: string };
      sessionId: string;
      websocketUrl: string;
    }
  | {
      type: "adaptation_required";
      adaptation: AdaptationRequired;
      message: string;
    }
  | {
      type: "mailbox";
      messages: Array<{
        senderName: string;
        senderDid: string;
        message: string;
        sourceServer: string;
        sentAt: string;
      }>;
    };

export function encodeMessage(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isStringOrUndefined(v: unknown): v is string | undefined {
  return v === undefined || typeof v === "string";
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

/** Per-variant field checks — payloads come from untrusted peers */
function isValidClientMessage(msg: Record<string, unknown>): boolean {
  switch (msg.type) {
    case "command":
      return isString(msg.id) && isString(msg.command) && isStringArray(msg.args);
    case "move":
      return isString(msg.id) && isString(msg.direction);
    case "chat":
      return isString(msg.channel) && isString(msg.message);
    case "interact":
      return isString(msg.id) && isString(msg.targetId) && isString(msg.action);
    case "adaptation_response":
      return isStringOrUndefined(msg.classId) && isStringOrUndefined(msg.raceId);
    case "ping":
      return true;
    default:
      return false;
  }
}

export function decodeClientMessage(data: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(data);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.type === "string" &&
      isValidClientMessage(parsed)
    ) {
      return parsed as ClientMessage;
    }
    return null;
  } catch {
    return null;
  }
}

export function decodeServerMessage(data: string): ServerMessage | null {
  try {
    const parsed = JSON.parse(data);
    if (typeof parsed === "object" && parsed !== null && typeof parsed.type === "string") {
      return parsed as ServerMessage;
    }
    return null;
  } catch {
    return null;
  }
}
