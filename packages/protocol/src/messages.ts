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

// ── Shared enums ──

/** Presentation style for a `narrative` line. The client adds a local-only
 *  `"room"` style on top of this set. */
export type NarrativeStyle = "info" | "error" | "combat" | "system" | "chat";

/** Channel a `chat` message was delivered on. */
export type ChatChannel = "say" | "room" | "tell" | "whisper" | "shout";

export type QuestStatus = "active" | "completed" | "failed";

export type CombatEndReason = "victory" | "flee" | "death";

// ── Shared payload types ──
// One named definition per payload shape, imported by producers (server) and
// consumers (client hooks) instead of being re-declared at each site.

export interface CharacterStatsPayload {
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

export interface MapSnapshot {
  grid: string[];
  cursorRow: number;
  cursorCol: number;
  legend: string[];
}

export interface QuestObjective {
  description: string;
  current: number;
  required: number;
  done: boolean;
}

export interface QuestRewards {
  xp?: number;
  gold?: number;
  items?: string[];
}

export interface QuestSnapshot {
  questId: string;
  questName: string;
  status: QuestStatus;
  objectives: QuestObjective[];
}

export interface PortalTarget {
  name: string;
  did: string;
  endpoint: string;
}

export interface PortalOffer {
  targetServer: PortalTarget;
  sessionId: string;
  websocketUrl: string;
}

export interface MailboxMessage {
  senderName: string;
  senderDid: string;
  message: string;
  sourceServer: string;
  sentAt: string;
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
  | { type: "narrative"; text: string; style?: NarrativeStyle }
  | { type: "entity_enter"; entity: EntityBrief; room: string }
  | { type: "entity_leave"; entity: EntityBrief; room: string; direction?: string }
  | { type: "chat"; channel: ChatChannel; sender: string; message: string }
  | { type: "error"; code: string; message: string }
  | { type: "ack"; id: string }
  | { type: "pong"; serverTime: number }
  | { type: "welcome"; sessionId: string; serverName: string }
  | { type: "inventory_update"; inventory: ItemInstance[] }
  | { type: "equipment_update"; equipment: Record<string, ItemInstance> }
  | ({ type: "character_update" } & CharacterStatsPayload)
  | { type: "combat_start"; target: string; combatants: CombatantInfo[] }
  | { type: "combat_update"; combatants: CombatantInfo[]; targetId: string }
  | { type: "combat_end"; reason: CombatEndReason }
  | { type: "level_up"; level: number; message: string }
  | ({ type: "map_update" } & MapSnapshot)
  | ({ type: "quest_update" } & QuestSnapshot & { rewards?: QuestRewards })
  | { type: "quest_log"; quests: QuestSnapshot[] }
  | ({ type: "portal_offer" } & PortalOffer)
  | {
      type: "adaptation_required";
      adaptation: AdaptationRequired;
      message: string;
    }
  | { type: "mailbox"; messages: MailboxMessage[] };

export function encodeMessage(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isStringOrUndefined(v: unknown): v is string | undefined {
  return v === undefined || typeof v === "string";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number";
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isArrayOf(v: unknown, pred: (x: unknown) => boolean): boolean {
  return Array.isArray(v) && v.every(pred);
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

function isQuestStatus(v: unknown): boolean {
  return v === "active" || v === "completed" || v === "failed";
}

function isCombatantInfo(v: unknown): boolean {
  return (
    isObject(v) &&
    isString(v.id) &&
    isString(v.name) &&
    isNumber(v.level) &&
    isNumber(v.hp) &&
    isNumber(v.maxHp)
  );
}

function isQuestObjective(v: unknown): boolean {
  return (
    isObject(v) &&
    isString(v.description) &&
    isNumber(v.current) &&
    isNumber(v.required) &&
    isBoolean(v.done)
  );
}

function isQuestSnapshot(v: unknown): boolean {
  return (
    isObject(v) &&
    isString(v.questId) &&
    isString(v.questName) &&
    isQuestStatus(v.status) &&
    isArrayOf(v.objectives, isQuestObjective)
  );
}

function isMailboxMessage(v: unknown): boolean {
  return (
    isObject(v) &&
    isString(v.senderName) &&
    isString(v.senderDid) &&
    isString(v.message) &&
    isString(v.sourceServer) &&
    isString(v.sentAt)
  );
}

function hasStringName(v: unknown): boolean {
  return isObject(v) && isString(v.name);
}

/**
 * Per-variant field checks for server messages. Server messages were
 * previously trusted and cast blindly, but the client also consumes messages
 * from servers it did not choose (portal handoff hands it a third-party
 * `websocketUrl` it will connect to), and malformed payloads that get
 * structurally dereferenced in the state hook would otherwise throw there
 * instead of failing cleanly at decode.
 */
function isValidServerMessage(msg: Record<string, unknown>): boolean {
  switch (msg.type) {
    case "room_state":
      return isObject(msg.room);
    case "narrative":
      return isString(msg.text) && isStringOrUndefined(msg.style);
    case "entity_enter":
      return hasStringName(msg.entity) && isString(msg.room);
    case "entity_leave":
      return hasStringName(msg.entity) && isString(msg.room) && isStringOrUndefined(msg.direction);
    case "chat":
      return isString(msg.channel) && isString(msg.sender) && isString(msg.message);
    case "error":
      return isString(msg.code) && isString(msg.message);
    case "ack":
      return isString(msg.id);
    case "pong":
      return isNumber(msg.serverTime);
    case "welcome":
      return isString(msg.sessionId) && isString(msg.serverName);
    case "inventory_update":
      return isArrayOf(msg.inventory, isObject);
    case "equipment_update":
      return isObject(msg.equipment);
    case "character_update":
      return (
        isNumber(msg.hp) &&
        isNumber(msg.maxHp) &&
        isNumber(msg.mp) &&
        isNumber(msg.maxMp) &&
        isNumber(msg.ap) &&
        isNumber(msg.maxAp) &&
        isNumber(msg.gold) &&
        isNumber(msg.level) &&
        isNumber(msg.xp) &&
        isNumber(msg.xpToNext)
      );
    case "combat_start":
      return isString(msg.target) && isArrayOf(msg.combatants, isCombatantInfo);
    case "combat_update":
      return isString(msg.targetId) && isArrayOf(msg.combatants, isCombatantInfo);
    case "combat_end":
      return msg.reason === "victory" || msg.reason === "flee" || msg.reason === "death";
    case "level_up":
      return isNumber(msg.level) && isString(msg.message);
    case "map_update":
      return (
        isStringArray(msg.grid) &&
        isNumber(msg.cursorRow) &&
        isNumber(msg.cursorCol) &&
        isStringArray(msg.legend)
      );
    case "quest_update":
      return (
        isString(msg.questId) &&
        isString(msg.questName) &&
        isQuestStatus(msg.status) &&
        isArrayOf(msg.objectives, isQuestObjective)
      );
    case "quest_log":
      return isArrayOf(msg.quests, isQuestSnapshot);
    case "portal_offer":
      return (
        hasStringName(msg.targetServer) && isString(msg.sessionId) && isString(msg.websocketUrl)
      );
    case "adaptation_required":
      return isObject(msg.adaptation) && isString(msg.message);
    case "mailbox":
      return isArrayOf(msg.messages, isMailboxMessage);
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
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.type === "string" &&
      isValidServerMessage(parsed)
    ) {
      return parsed as ServerMessage;
    }
    return null;
  } catch {
    return null;
  }
}
