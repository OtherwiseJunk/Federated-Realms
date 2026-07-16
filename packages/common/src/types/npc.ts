import type { NpcDefinition, NpcBehavior, Attributes, AttributeDef } from "@realms/lexicons";

export type NpcState = "idle" | "wandering" | "conversing" | "combat" | "fleeing" | "dead";

export interface NpcInstance {
  instanceId: string;
  definitionId: string;
  name: string;
  behavior: NpcBehavior;
  state: NpcState;
  level: number;
  currentRoom: string;
  attributes: Attributes;
  currentHp: number;
  maxHp: number;
}

/** Compute NPC max HP from level and constitution */
export function computeNpcMaxHp(level: number, attributes: Attributes): number {
  const con = attributes.con;
  return 10 + level * 5 + Math.max(0, Math.floor((con - 10) / 2));
}

export function generateNpcId(): string {
  return `npc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Resolve an NPC's full attribute record at spawn time. Every attribute the
 * system defines gets its configured default (AttributeDef.defaultValue ?? 10),
 * then the definition's explicit attributes override those. This mirrors the
 * player path (buildAttributes) so NPCs honor the system's attribute defaults
 * instead of a hardcoded 10 re-derived at every combat use site.
 */
function resolveNpcAttributes(
  attributeDefs: Record<string, AttributeDef>,
  overrides: Attributes | undefined,
): Attributes {
  const attributes: Attributes = {};
  for (const [id, def] of Object.entries(attributeDefs)) {
    attributes[id] = def.defaultValue ?? 10;
  }
  return { ...attributes, ...overrides };
}

export function createNpcInstance(
  definitionId: string,
  definition: NpcDefinition,
  roomId: string,
  attributeDefs: Record<string, AttributeDef>,
): NpcInstance {
  const level = definition.level ?? 1;
  const attributes = resolveNpcAttributes(attributeDefs, definition.attributes);
  const maxHp = computeNpcMaxHp(level, attributes);

  return {
    instanceId: generateNpcId(),
    definitionId,
    name: definition.name,
    behavior: definition.behavior,
    state: "idle",
    level,
    currentRoom: roomId,
    attributes,
    currentHp: maxHp,
    maxHp,
  };
}
