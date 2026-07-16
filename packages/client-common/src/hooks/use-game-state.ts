import { useState, useEffect, useCallback } from "react";
import type {
  ServerMessage,
  CombatantInfo,
  AdaptationRequired,
  NarrativeStyle,
  CharacterStatsPayload,
  MapSnapshot,
  QuestObjective,
  QuestSnapshot,
  PortalOffer,
} from "@realms/protocol";
import type { RoomState, ItemInstance } from "@realms/common";
import type { WsClient } from "../connection/ws-client.js";

export type EquipmentMap = Record<string, ItemInstance>;

export interface NarrativeLine {
  text: string;
  // Protocol narrative styles plus a client-only "room" style.
  style: NarrativeStyle | "room";
  timestamp: number;
}

// The payload shapes below are defined once in @realms/protocol and shared by
// producers (server) and consumers (this hook). The aliases keep the public
// names this hook has always exported while removing the duplicated field
// declarations that used to drift from the protocol.
export type CharacterStats = CharacterStatsPayload;
export type QuestObjectiveEntry = QuestObjective;
export type QuestEntry = QuestSnapshot;
export type MapState = MapSnapshot;
export type PortalOfferState = PortalOffer;

export interface CombatState {
  active: boolean;
  combatants: CombatantInfo[];
  targetId: string;
}

export interface GameState {
  connected: boolean;
  sessionId: string | null;
  serverName: string | null;
  room: RoomState | null;
  stats: CharacterStats | null;
  map: MapState | null;
  combat: CombatState | null;
  inventory: ItemInstance[];
  equipment: EquipmentMap;
  narrative: NarrativeLine[];
  quests: QuestEntry[];
  portalOffer: PortalOfferState | null;
  adaptation: AdaptationRequired | null;
}

const MAX_NARRATIVE = 500;

export function useGameState(client: WsClient) {
  const [state, setState] = useState<GameState>({
    connected: false,
    sessionId: null,
    serverName: null,
    room: null,
    stats: null,
    map: null,
    combat: null,
    inventory: [],
    equipment: {},
    narrative: [],
    quests: [],
    portalOffer: null,
    adaptation: null,
  });

  const addNarrative = useCallback((text: string, style: NarrativeLine["style"] = "info") => {
    const entries = text.split("\n").map((line) => ({ text: line, style, timestamp: Date.now() }));
    setState((prev) => ({
      ...prev,
      narrative: [...prev.narrative.slice(-(MAX_NARRATIVE - entries.length)), ...entries],
    }));
  }, []);

  useEffect(() => {
    const unsubscribe = client.onMessage((msg: ServerMessage) => {
      switch (msg.type) {
        case "welcome":
          setState((prev) => ({
            ...prev,
            connected: true,
            sessionId: msg.sessionId,
            serverName: msg.serverName,
          }));
          addNarrative(`Connected to ${msg.serverName}`, "system");
          break;

        case "room_state":
          setState((prev) => ({ ...prev, room: msg.room }));
          break;

        case "narrative":
          addNarrative(msg.text, msg.style ?? "info");
          break;

        case "combat_start":
          setState((prev) => ({
            ...prev,
            combat: {
              active: true,
              combatants: msg.combatants,
              targetId: msg.combatants[0]?.id ?? "",
            },
          }));
          addNarrative(`Combat begins! ${msg.target} attacks!`, "combat");
          break;

        case "combat_update":
          setState((prev) => ({
            ...prev,
            combat: prev.combat
              ? {
                  ...prev.combat,
                  combatants: msg.combatants,
                  targetId: msg.targetId,
                }
              : {
                  active: true,
                  combatants: msg.combatants,
                  targetId: msg.targetId,
                },
          }));
          break;

        case "combat_end":
          setState((prev) => ({ ...prev, combat: null }));
          addNarrative(
            msg.reason === "victory"
              ? "Combat ends — victory!"
              : msg.reason === "flee"
                ? "You escaped from combat."
                : "You have been defeated.",
            "combat",
          );
          break;

        case "character_update": {
          const { type: _type, ...stats } = msg;
          setState((prev) => ({ ...prev, stats }));
          break;
        }

        case "map_update": {
          const { type: _type, ...map } = msg;
          setState((prev) => ({ ...prev, map }));
          break;
        }

        case "level_up":
          addNarrative(`Level up! You are now level ${msg.level}!`, "system");
          break;

        case "entity_enter":
          addNarrative(`${msg.entity.name} has arrived.`, "system");
          break;

        case "entity_leave":
          addNarrative(
            `${msg.entity.name} left${msg.direction ? ` to the ${msg.direction}` : ""}.`,
            "system",
          );
          break;

        case "chat":
          if (msg.channel === "tell") {
            addNarrative(`${msg.sender} tells you: ${msg.message}`, "chat");
          } else if (msg.channel === "whisper") {
            addNarrative(`${msg.sender} whispers: ${msg.message}`, "chat");
          } else if (msg.channel === "shout") {
            addNarrative(`${msg.sender} shouts: ${msg.message}`, "chat");
          } else {
            addNarrative(`${msg.sender} says: ${msg.message}`, "chat");
          }
          break;

        case "mailbox":
          if (msg.messages.length > 0) {
            addNarrative(`You have ${msg.messages.length} message(s) waiting:`, "system");
            for (const m of msg.messages) {
              addNarrative(`  [${m.sentAt}] ${m.senderName}: ${m.message}`, "chat");
            }
          }
          break;

        case "inventory_update":
          setState((prev) => ({ ...prev, inventory: msg.inventory }));
          break;

        case "equipment_update":
          setState((prev) => ({ ...prev, equipment: msg.equipment }));
          break;

        case "error":
          if (msg.code === "DISCONNECTED") {
            setState((prev) => ({ ...prev, connected: false }));
            addNarrative("Disconnected from server.", "error");
          } else {
            addNarrative(`[${msg.code}] ${msg.message}`, "error");
          }
          break;

        case "quest_update": {
          const entry: QuestEntry = {
            questId: msg.questId,
            questName: msg.questName,
            status: msg.status,
            objectives: msg.objectives,
          };
          setState((prev) => ({
            ...prev,
            quests: [...prev.quests.filter((q) => q.questId !== msg.questId), entry].filter(
              (q) => q.status === "active",
            ),
          }));
          if (msg.status === "completed") {
            addNarrative(`\u2605 Quest complete: ${msg.questName}!`, "system");
          } else {
            const lastDone = [...msg.objectives].reverse().find((o) => o.done);
            if (lastDone) {
              addNarrative(`\u2713 Objective: ${lastDone.description}`, "system");
            }
          }
          break;
        }

        case "quest_log":
          setState((prev) => ({
            ...prev,
            quests: msg.quests.filter((q) => q.status === "active"),
          }));
          break;

        case "portal_offer": {
          const { type: _type, ...portalOffer } = msg;
          setState((prev) => ({ ...prev, portalOffer }));
          addNarrative(`The portal pulls you through to ${msg.targetServer.name}...`, "system");
          break;
        }

        case "adaptation_required":
          setState((prev) => ({ ...prev, adaptation: msg.adaptation }));
          addNarrative(msg.message, "system");
          break;

        case "pong":
        case "ack":
          break;
      }
    });

    return unsubscribe;
  }, [client, addNarrative]);

  return state;
}
