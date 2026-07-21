import type { AtpAgent } from "@atproto/api";
import { NSID } from "@realms/lexicons";
import type { Main as AreaRecord } from "@realms/lexicons/src/lexicons/com/cacheblasters/realms/world/area.defs.js";
import type {
  Main as RoomRecord,
  Exit as RoomExit,
} from "@realms/lexicons/src/lexicons/com/cacheblasters/realms/world/room.defs.js";
import type { Main as ItemRecord } from "@realms/lexicons/src/lexicons/com/cacheblasters/realms/item/definition.defs.js";
import type { Main as NpcRecord } from "@realms/lexicons/src/lexicons/com/cacheblasters/realms/npc/definition.defs.js";
import type {
  Main as QuestRecord,
  Objective as QuestObjective,
} from "@realms/lexicons/src/lexicons/com/cacheblasters/realms/quest/definition.defs.js";
import type {
  Main as RecipeRecord,
  Ingredient as RecipeIngredient,
} from "@realms/lexicons/src/lexicons/com/cacheblasters/realms/craft/recipe.defs.js";
import type { Main as PortalRecord } from "@realms/lexicons/src/lexicons/com/cacheblasters/realms/world/portal.defs.js";
import type { WorldManager } from "../world/world-manager.js";

// Each record literal below is annotated `satisfies <lexicon Main>` so that a
// renamed or newly-required lexicon field fails compilation here instead of
// silently dropping from published records (issue #82). Nested array elements
// carry explicit return types (RoomExit / QuestObjective / RecipeIngredient) so
// the same check reaches inside `.map(...)`.
export class WorldPublisher {
  constructor(
    private agent: AtpAgent,
    private did: string,
  ) {}

  async publishAll(world: WorldManager): Promise<{ portalCount: number }> {
    const stats = { areas: 0, rooms: 0, items: 0, npcs: 0, quests: 0, recipes: 0, portals: 0 };

    for (const [id, area] of world.areaManager.getAllAreas()) {
      const record = {
        $type: NSID.WorldArea,
        title: area.title,
        description: area.description,
        levelRange: area.levelRange,
      } satisfies AreaRecord;
      if (await this.putRecord(NSID.WorldArea, toRkey(id), record)) stats.areas++;
    }

    for (const [id, room] of world.areaManager.getAllRooms()) {
      const areaId = id.split(":")[0];
      const record = {
        $type: NSID.WorldRoom,
        title: room.title,
        description: room.description,
        area: areaId,
        coordinates: room.coordinates,
        exits: room.exits.map(
          (e): RoomExit => ({
            direction: e.direction,
            target: e.target,
            portal: e.portal || undefined,
            requiredLevel: e.requiredLevel || undefined,
            description: e.description || undefined,
          }),
        ),
        flags: room.flags.length > 0 ? room.flags : undefined,
      } satisfies RoomRecord;
      if (await this.putRecord(NSID.WorldRoom, toRkey(id), record)) stats.rooms++;
    }

    for (const [id, item] of world.areaManager.getAllItemDefinitions()) {
      const record = {
        $type: NSID.ItemDefinition,
        name: item.name,
        type: item.type,
        description: item.description,
        weight: item.weight,
        value: item.value,
        rarity: item.rarity,
        levelRequired: item.levelRequired,
        stackable: item.stackable ? true : undefined,
        maxStack: item.maxStack === (item.stackable ? 99 : 1) ? undefined : item.maxStack,
        // Open map: app-facing values are `unknown`; assert to the lexicon's LexMap.
        properties: item.properties as ItemRecord["properties"],
        tags: item.tags?.length ? item.tags : undefined,
      } satisfies ItemRecord;
      if (await this.putRecord(NSID.ItemDefinition, toRkey(id), record)) stats.items++;
    }

    for (const [id, npc] of world.npcManager.getAllDefinitions()) {
      const record = {
        $type: NSID.NpcDefinition,
        name: npc.name,
        description: npc.description,
        behavior: npc.behavior,
        level: npc.level,
        attackCooldown: npc.attackCooldown,
        attributes: npc.attributes,
        dialogue: npc.dialogue,
        art: npc.art?.length ? npc.art : undefined,
        shop: npc.shop?.length ? npc.shop : undefined,
        tags: npc.tags?.length ? npc.tags : undefined,
      } satisfies NpcRecord;
      if (await this.putRecord(NSID.NpcDefinition, toRkey(id), record)) stats.npcs++;
    }

    for (const [id, quest] of world.questManager.getAllDefinitions()) {
      const record = {
        $type: NSID.QuestDefinition,
        name: quest.name,
        description: quest.description,
        level: quest.level,
        giver: quest.giver,
        turnIn: quest.turnIn,
        prerequisites: quest.prerequisites?.length ? quest.prerequisites : undefined,
        objectives: quest.objectives.map(
          (o): QuestObjective => ({
            type: o.type,
            description: o.description,
            target: o.target,
            count: o.count === 1 ? undefined : o.count,
          }),
        ),
        ordered: quest.ordered ? undefined : false,
        rewards: quest.rewards,
        repeatable: quest.repeatable ? true : undefined,
        consumeItems: quest.consumeItems ? undefined : false,
        tags: quest.tags?.length ? quest.tags : undefined,
      } satisfies QuestRecord;
      if (await this.putRecord(NSID.QuestDefinition, toRkey(id), record)) stats.quests++;
    }

    for (const [id, recipe] of world.craftingSystem.getAllRecipes()) {
      const record = {
        $type: NSID.CraftRecipe,
        name: recipe.name,
        description: recipe.description,
        station: recipe.station,
        levelRequired: recipe.levelRequired,
        ingredients: recipe.ingredients.map(
          (ing): RecipeIngredient => ({ itemId: ing.itemId, count: ing.count }),
        ),
        output: { itemId: recipe.output.itemId, count: recipe.output.count },
        successChance: recipe.successChance,
        tags: recipe.tags?.length ? recipe.tags : undefined,
      } satisfies RecipeRecord;
      if (await this.putRecord(NSID.CraftRecipe, toRkey(id), record)) stats.recipes++;
    }

    for (const [id, room] of world.areaManager.getAllRooms()) {
      for (const exit of room.exits) {
        if (!exit.portal) continue;

        const parts = exit.target.split(":");
        if (parts.length < 4) continue;

        const targetRoom = parts.pop()!;
        const targetServerDid = parts.join(":");

        const portalRkey = `${toRkey(id)}-${exit.direction}`;
        const record = {
          $type: NSID.WorldPortal,
          sourceRoom: id,
          direction: exit.direction,
          // Federated room targets carry the destination server DID by construction.
          targetServerDid: targetServerDid as PortalRecord["targetServerDid"],
          targetRoom,
          description: exit.description || undefined,
          requiredLevel: exit.requiredLevel || undefined,
        } satisfies PortalRecord;
        if (await this.putRecord(NSID.WorldPortal, portalRkey, record)) stats.portals++;
      }
    }

    console.log(
      `   Published world data: ${stats.areas} areas, ${stats.rooms} rooms, ` +
        `${stats.items} items, ${stats.npcs} NPCs, ${stats.quests} quests, ${stats.recipes} recipes` +
        (stats.portals > 0 ? `, ${stats.portals} portals` : ""),
    );

    return { portalCount: stats.portals };
  }

  /** Publish a single record. Returns true on success, false if the write failed. */
  private async putRecord(
    collection: string,
    rkey: string,
    record: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      await this.agent.com.atproto.repo.putRecord({
        repo: this.did,
        collection,
        rkey,
        record,
      });
      return true;
    } catch (err) {
      console.warn(
        `   Failed to publish ${collection}/${rkey}:`,
        err instanceof Error ? err.message : err,
      );
      return false;
    }
  }
}

function toRkey(id: string): string {
  return id.replace(/:/g, "-").replace(/[^a-zA-Z0-9._~-]/g, "-");
}
