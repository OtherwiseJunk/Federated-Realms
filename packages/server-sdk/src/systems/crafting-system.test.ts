import { describe, expect, test } from "bun:test";
import { CraftingSystem } from "./crafting-system.js";
import { CharacterSession } from "../entities/character-session.js";
import type { CharacterProfile, ItemDefinition, RecipeDef } from "@realms/lexicons";
import { createItemInstance } from "@realms/common";

function makeProfile(): CharacterProfile {
  return {
    name: "TestHero",
    class: "warrior",
    race: "human",
    level: 1,
    experience: 0,
    attributes: { str: 14, dex: 12, con: 13, int: 10, wis: 10, cha: 12 },
    createdAt: new Date().toISOString(),
  };
}

function makeSession(): CharacterSession {
  return new CharacterSession("session-1", "did:plc:test", makeProfile(), "test-area:spawn", {});
}

function makeItemDef(name: string): ItemDefinition {
  return { name, type: "material", description: `A ${name}.`, stackable: true, maxStack: 99 };
}

const ITEM_DEFS = new Map<string, ItemDefinition>([
  ["test-area:mushroom", makeItemDef("Dreamcap Mushroom")],
  ["test-area:potion", makeItemDef("Dream Potion")],
]);

describe("CraftingSystem gather", () => {
  test("gathered items report their definition id", () => {
    const crafting = new CraftingSystem();
    crafting.registerGatheringNode({
      id: "test-area:caps",
      name: "Luminaris Caps",
      description: "Glowing mushrooms.",
      roomId: "test-area:spawn",
      respawnSeconds: 60,
      yields: [{ itemId: "test-area:mushroom", chance: 100, min: 2, max: 2 }],
    });
    const session = makeSession();

    const result = crafting.gather(session, "test-area:spawn", undefined, ITEM_DEFS);

    expect(result.success).toBe(true);
    expect(result.items).toEqual([
      { itemId: "test-area:mushroom", name: "Dreamcap Mushroom", count: 2 },
    ]);
  });
});

describe("CraftingSystem craft", () => {
  test("craft result reports the output definition id", () => {
    const crafting = new CraftingSystem();
    const recipe: RecipeDef = {
      name: "Dream Potion",
      ingredients: [{ itemId: "test-area:mushroom", count: 2 }],
      output: { itemId: "test-area:potion", count: 1 },
    } as RecipeDef;
    crafting.registerRecipe("test-area:dream-potion", recipe);
    const session = makeSession();
    const mushroomDef = ITEM_DEFS.get("test-area:mushroom")!;
    session.addItem(createItemInstance("test-area:mushroom", mushroomDef, 2), mushroomDef);

    const result = crafting.craft(session, { flags: [] } as never, "dream potion", ITEM_DEFS);

    expect(result.success).toBe(true);
    expect(result.outputItemId).toBe("test-area:potion");
    expect(result.outputCount).toBe(1);
  });

  test("craft prefers an exact recipe match over an earlier substring match", () => {
    const crafting = new CraftingSystem();
    // Registered first: its name contains the query "Potion" as a substring,
    // so the old first-includes() lookup would pick this one.
    crafting.registerRecipe("test-area:greater-potion", {
      name: "Greater Potion",
      ingredients: [{ itemId: "test-area:mushroom", count: 5 }],
      output: { itemId: "test-area:potion", count: 1 },
    } as RecipeDef);
    // Registered second: an exact name match for the query.
    crafting.registerRecipe("test-area:potion", {
      name: "Potion",
      ingredients: [{ itemId: "test-area:mushroom", count: 2 }],
      output: { itemId: "test-area:potion", count: 1 },
    } as RecipeDef);

    const session = makeSession();
    session.addItem(
      createItemInstance("test-area:mushroom", ITEM_DEFS.get("test-area:mushroom")!, 2),
      ITEM_DEFS.get("test-area:mushroom"),
    );

    const result = crafting.craft(session, { flags: [] } as never, "Potion", ITEM_DEFS);

    // The exact "Potion" recipe needs only the 2 mushrooms on hand and crafts
    // successfully. If the substring "Greater Potion" were wrongly chosen, it
    // would report missing ingredients (5 needed) instead.
    expect(result.success).toBe(true);
    expect(result.outputItemId).toBe("test-area:potion");
  });

  test("craft still falls back to a substring match when no exact match exists", () => {
    const crafting = new CraftingSystem();
    const recipe: RecipeDef = {
      name: "Dream Potion",
      ingredients: [{ itemId: "test-area:mushroom", count: 2 }],
      output: { itemId: "test-area:potion", count: 1 },
    } as RecipeDef;
    crafting.registerRecipe("test-area:dream-potion", recipe);
    const session = makeSession();
    session.addItem(
      createItemInstance("test-area:mushroom", ITEM_DEFS.get("test-area:mushroom")!, 2),
      ITEM_DEFS.get("test-area:mushroom"),
    );

    const result = crafting.craft(session, { flags: [] } as never, "dream", ITEM_DEFS);

    expect(result.success).toBe(true);
    expect(result.outputItemId).toBe("test-area:potion");
  });
});
