import type { AtpAgent } from "@atproto/api";
import { NSID } from "@realms/lexicons";
import type { WorldManager } from "../world/world-manager.js";

/**
 * Publishes world data (areas, rooms, items, NPCs, quests, recipes)
 * as AT Proto records on the server's PDS. This makes the server's
 * content discoverable by other servers and clients via the AT Proto network.
 *
 * Records are keyed by their game ID (e.g., "starter-town:town-square")
 * with colons replaced by dashes for valid rkeys.
 */
export class WorldPublisher {
  constructor(
    private agent: AtpAgent,
    private did: string,
  ) {}

  /**
   * Publish all world data from the WorldManager to the server's PDS.
   * Called once after server initialization.
   */
  async publishAll(world: WorldManager): Promise<{ portalCount: number }> {
    const stats = { areas: 0, rooms: 0, items: 0, npcs: 0, quests: 0, recipes: 0, portals: 0 };

    // Areas
    for (const [id, area] of world.areaManager.getAllAreas()) {
      await this.putRecord(NSID.WorldArea, toRkey(id), {
        $type: NSID.WorldArea,
        title: area.title,
        description: area.description,
        levelRange: area.levelRange,
      });
      stats.areas++;
    }

    // Rooms
    for (const [id, room] of world.areaManager.getAllRooms()) {
      const areaId = id.split(":")[0];
      await this.putRecord(NSID.WorldRoom, toRkey(id), {
        $type: NSID.WorldRoom,
        title: room.title,
        description: room.description,
        area: areaId,
        coordinates: room.coordinates,
        exits: room.exits.map((e) => ({
          direction: e.direction,
          target: e.target,
          portal: e.portal || undefined,
          requiredLevel: e.requiredLevel || undefined,
          description: e.description || undefined,
        })),
        flags: room.flags.length > 0 ? room.flags : undefined,
      });
      stats.rooms++;
    }

    // Items
    for (const [id, item] of world.areaManager.getAllItemDefinitions()) {
      await this.putRecord(NSID.ItemDefinition, toRkey(id), {
        $type: NSID.ItemDefinition,
        name: item.name,
        type: item.type,
        description: item.description,
        weight: item.weight,
        value: item.value,
        rarity: item.rarity,
        levelRequired: item.levelRequired,
        stackable: item.stackable,
        maxStack: item.maxStack,
        properties: item.properties,
        tags: item.tags?.length ? item.tags : undefined,
      });
      stats.items++;
    }

    // NPCs
    for (const [id, npc] of world.npcManager.getAllDefinitions()) {
      await this.putRecord(NSID.NpcDefinition, toRkey(id), {
        $type: NSID.NpcDefinition,
        name: npc.name,
        description: npc.description,
        behavior: npc.behavior,
        level: npc.level,
        attributes: npc.attributes,
        art: npc.art?.length ? npc.art : undefined,
        tags: npc.tags?.length ? npc.tags : undefined,
      });
      stats.npcs++;
    }

    // Quests
    for (const [id, quest] of world.questManager.getAllDefinitions()) {
      await this.putRecord(NSID.QuestDefinition, toRkey(id), {
        $type: NSID.QuestDefinition,
        name: quest.name,
        description: quest.description,
        level: quest.level,
        giver: quest.giver,
        turnIn: quest.turnIn,
        prerequisites: quest.prerequisites?.length ? quest.prerequisites : undefined,
        objectives: quest.objectives.map((o) => ({
          type: o.type,
          description: o.description,
          target: o.target,
          count: o.count,
        })),
        rewards: quest.rewards,
        repeatable: quest.repeatable,
        tags: quest.tags?.length ? quest.tags : undefined,
      });
      stats.quests++;
    }

    // Recipes
    for (const [id, recipe] of world.craftingSystem.getAllRecipes()) {
      await this.putRecord(NSID.CraftRecipe, toRkey(id), {
        $type: NSID.CraftRecipe,
        name: recipe.name,
        description: recipe.description,
        station: recipe.station,
        levelRequired: recipe.levelRequired,
        ingredients: recipe.ingredients,
        output: recipe.output,
        successChance: recipe.successChance,
        tags: recipe.tags?.length ? recipe.tags : undefined,
      });
      stats.recipes++;
    }

    // Portals (extracted from room exits with portal: true)
    for (const [id, room] of world.areaManager.getAllRooms()) {
      for (const exit of room.exits) {
        if (!exit.portal) continue;

        // Portal targets are "did:plc:xxx:room-id" format
        const parts = exit.target.split(":");
        if (parts.length < 4) continue; // Need at least did:method:id:room

        const targetRoom = parts.pop()!;
        const targetServerDid = parts.join(":");

        const portalRkey = `${toRkey(id)}-${exit.direction}`;
        await this.putRecord(NSID.WorldPortal, portalRkey, {
          $type: NSID.WorldPortal,
          sourceRoom: id,
          direction: exit.direction,
          targetServerDid,
          targetRoom,
          description: exit.description || undefined,
          requiredLevel: exit.requiredLevel || undefined,
        });
        stats.portals++;
      }
    }

    console.log(
      `   Published world data: ${stats.areas} areas, ${stats.rooms} rooms, ` +
        `${stats.items} items, ${stats.npcs} NPCs, ${stats.quests} quests, ${stats.recipes} recipes` +
        (stats.portals > 0 ? `, ${stats.portals} portals` : ""),
    );

    return { portalCount: stats.portals };
  }

  private async putRecord(
    collection: string,
    rkey: string,
    record: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.agent.com.atproto.repo.putRecord({
        repo: this.did,
        collection,
        rkey,
        record,
      });
    } catch (err) {
      console.warn(
        `   Failed to publish ${collection}/${rkey}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/** Convert a game ID to a valid AT Proto rkey (alphanumeric + hyphens) */
function toRkey(id: string): string {
  return id.replace(/:/g, "-").replace(/[^a-zA-Z0-9._~-]/g, "-");
}
