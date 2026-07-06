import type { RecipeDef, ItemDefinition } from "@realms/lexicons";
import type { CharacterSession } from "../entities/character-session.js";
import type { Room } from "../world/room.js";
import { createItemInstance } from "@realms/common";

export interface GatherYield {
  itemId: string; // area-prefixed
  chance: number; // 0-100
  min: number;
  max: number;
}

export interface GatheringNode {
  id: string;
  name: string;
  description: string;
  roomId: string;
  respawnSeconds: number;
  yields: GatherYield[];
}

interface NodeState {
  depletedAt?: number; // Date.now() when last gathered
}

export interface CraftResult {
  success: boolean;
  outputName?: string;
  outputCount?: number;
  missingIngredients?: { name: string; have: number; need: number }[];
  failedRoll?: boolean; // true when ingredients consumed but roll failed
  reason?: string;
}

export interface GatherResult {
  success: boolean;
  node?: GatheringNode;
  items?: { name: string; count: number }[];
  depleted?: boolean;
  reason?: string;
}

export class CraftingSystem {
  // recipeId -> RecipeDef
  private recipes = new Map<string, RecipeDef>();
  // roomId -> GatheringNode[]
  private nodesByRoom = new Map<string, GatheringNode[]>();
  // nodeId -> NodeState
  private nodeState = new Map<string, NodeState>();

  registerRecipe(id: string, def: RecipeDef): void {
    this.recipes.set(id, def);
  }

  registerGatheringNode(node: GatheringNode): void {
    let nodes = this.nodesByRoom.get(node.roomId);
    if (!nodes) {
      nodes = [];
      this.nodesByRoom.set(node.roomId, nodes);
    }
    nodes.push(node);
    this.nodeState.set(node.id, {});
  }

  getRecipe(id: string): RecipeDef | undefined {
    return this.recipes.get(id);
  }

  getAllRecipes(): Map<string, RecipeDef> {
    return this.recipes;
  }

  getNodesInRoom(roomId: string): GatheringNode[] {
    return this.nodesByRoom.get(roomId) ?? [];
  }

  isNodeDepleted(nodeId: string): boolean {
    const state = this.nodeState.get(nodeId);
    if (!state?.depletedAt) return false;
    const node = this.findNodeById(nodeId);
    if (!node) return false;
    return Date.now() - state.depletedAt < node.respawnSeconds * 1000;
  }

  /** List all recipes. If session+room provided, filter to craftable only. */
  listRecipes(
    session?: CharacterSession,
    room?: Room,
  ): Array<{ id: string; def: RecipeDef; craftable: boolean; missingStation?: string }> {
    const result = [];
    for (const [id, def] of this.recipes.entries()) {
      if (session && room) {
        const check = this.checkCraftable(session, room, def);
        result.push({ id, def, craftable: check.ok, missingStation: check.missingStation });
      } else {
        result.push({ id, def, craftable: false });
      }
    }
    return result;
  }

  craft(
    session: CharacterSession,
    room: Room,
    recipeName: string,
    itemDefs: Map<string, ItemDefinition>,
  ): CraftResult {
    // Find recipe by name or partial match
    const lower = recipeName.toLowerCase();
    let matchId: string | undefined;
    let matchDef: RecipeDef | undefined;
    for (const [id, def] of this.recipes.entries()) {
      if (def.name.toLowerCase().includes(lower)) {
        matchId = id;
        matchDef = def;
        break;
      }
    }

    if (!matchId || !matchDef) {
      return {
        success: false,
        reason: `Unknown recipe '${recipeName}'. Use 'recipes' to see what you can make.`,
      };
    }

    // Check level requirement
    if (matchDef.levelRequired && session.state.level < matchDef.levelRequired) {
      return {
        success: false,
        reason: `You need to be level ${matchDef.levelRequired} to craft ${matchDef.name}.`,
      };
    }

    // Check station requirement
    if (matchDef.station) {
      const hasStation = room.flags?.includes(`station:${matchDef.station}`) ?? false;
      if (!hasStation) {
        return {
          success: false,
          reason: `You need a ${matchDef.station} to craft ${matchDef.name}. Find a room with one.`,
        };
      }
    }

    // Check ingredients
    const missing: { name: string; have: number; need: number }[] = [];
    for (const ing of matchDef.ingredients) {
      const have = session.countItem(ing.itemId);
      if (have < ing.count) {
        const def = itemDefs.get(ing.itemId);
        missing.push({ name: def?.name ?? ing.itemId, have, need: ing.count });
      }
    }

    if (missing.length > 0) {
      return { success: false, missingIngredients: missing };
    }

    // Roll success chance
    const chance = matchDef.successChance ?? 100;
    const roll = Math.random() * 100;

    // Consume ingredients regardless of success (if chance < 100)
    for (const ing of matchDef.ingredients) {
      session.removeItemByDefId(ing.itemId, ing.count);
    }

    if (roll >= chance) {
      return { success: false, failedRoll: true };
    }

    // Create output item
    const outputDef = itemDefs.get(matchDef.output.itemId);
    if (!outputDef) {
      return {
        success: false,
        reason: `Output item definition not found: ${matchDef.output.itemId}`,
      };
    }
    const outputItem = createItemInstance(matchDef.output.itemId, outputDef, matchDef.output.count);
    session.addItem(outputItem);
    session.attestations.recordItemGrant(matchDef.output.itemId);

    return {
      success: true,
      outputName: outputDef.name,
      outputCount: matchDef.output.count,
    };
  }

  gather(
    session: CharacterSession,
    roomId: string,
    nodeName: string | undefined,
    itemDefs: Map<string, ItemDefinition>,
  ): GatherResult {
    const nodes = this.getNodesInRoom(roomId);
    if (nodes.length === 0) {
      return { success: false, reason: "There's nothing to gather here." };
    }

    let node: GatheringNode;
    if (nodeName) {
      const lower = nodeName.toLowerCase();
      const found = nodes.find((n) => n.name.toLowerCase().includes(lower));
      if (!found) {
        return {
          success: false,
          reason: `No gathering node matching '${nodeName}' here. Try just 'gather'.`,
        };
      }
      node = found;
    } else if (nodes.length === 1) {
      node = nodes[0];
    } else {
      // Multiple nodes — list them
      const names = nodes.map((n) => `'${n.name}'`).join(", ");
      return {
        success: false,
        reason: `Multiple gathering spots here: ${names}. Specify one: gather <name>`,
      };
    }

    if (this.isNodeDepleted(node.id)) {
      return { success: true, node, depleted: true };
    }

    // Mark depleted
    this.nodeState.set(node.id, { depletedAt: Date.now() });

    // Roll yields
    const gained: { name: string; count: number }[] = [];
    for (const yld of node.yields) {
      const roll = Math.random() * 100;
      if (roll < yld.chance) {
        const count = yld.min + Math.floor(Math.random() * (yld.max - yld.min + 1));
        const def = itemDefs.get(yld.itemId);
        if (def) {
          const item = createItemInstance(yld.itemId, def, count);
          session.addItem(item);
          session.attestations.recordItemGrant(yld.itemId);
          gained.push({ name: def.name, count });
        }
      }
    }

    if (gained.length === 0) {
      return { success: true, node, items: [] };
    }

    return { success: true, node, items: gained };
  }

  processRespawns(): void {
    // Respawn is checked lazily in isNodeDepleted(), no active processing needed
  }

  private findNodeById(nodeId: string): GatheringNode | undefined {
    for (const nodes of this.nodesByRoom.values()) {
      const found = nodes.find((n) => n.id === nodeId);
      if (found) return found;
    }
    return undefined;
  }

  private checkCraftable(
    session: CharacterSession,
    room: Room,
    def: RecipeDef,
  ): { ok: boolean; missingStation?: string } {
    if (def.station) {
      const hasStation = room.flags?.includes(`station:${def.station}`) ?? false;
      if (!hasStation) return { ok: false, missingStation: def.station };
    }
    for (const ing of def.ingredients) {
      if (session.countItem(ing.itemId) < ing.count) return { ok: false };
    }
    return { ok: true };
  }
}
