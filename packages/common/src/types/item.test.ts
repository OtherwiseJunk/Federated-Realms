import { describe, expect, test } from "bun:test";
import { createItemInstance, generateItemId, addItemToStacks, splitItemStack } from "./item.js";
import type { ItemInstance } from "./item.js";
import type { ItemDefinition } from "@realms/lexicons";

describe("generateItemId", () => {
  test("generates unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateItemId());
    }
    expect(ids.size).toBe(100);
  });

  test("starts with item_ prefix", () => {
    expect(generateItemId()).toMatch(/^item_/);
  });
});

describe("createItemInstance", () => {
  const sword: ItemDefinition = {
    name: "Iron Sword",
    type: "weapon",
    description: "A basic sword.",
    weight: 3,
    value: 10,
    stackable: false,
    maxStack: 1,
  };

  const potion: ItemDefinition = {
    name: "Health Potion",
    type: "consumable",
    description: "Heals wounds.",
    stackable: true,
    maxStack: 10,
  };

  test("creates instance with correct fields", () => {
    const item = createItemInstance("starter:iron-sword", sword);
    expect(item.definitionId).toBe("starter:iron-sword");
    expect(item.name).toBe("Iron Sword");
    expect(item.quantity).toBe(1);
    expect(item.instanceId).toMatch(/^item_/);
  });

  test("respects quantity", () => {
    const item = createItemInstance("starter:potion", potion, 5);
    expect(item.quantity).toBe(5);
  });

  test("caps quantity at maxStack for stackable items", () => {
    const item = createItemInstance("starter:potion", potion, 50);
    expect(item.quantity).toBe(10);
  });

  test("non-stackable items default to quantity 1", () => {
    const item = createItemInstance("starter:iron-sword", sword, 5);
    expect(item.quantity).toBe(1);
  });

  test("copies properties from definition", () => {
    const def: ItemDefinition = {
      name: "Magic Ring",
      type: "accessory",
      description: "Shiny.",
      stackable: false,
      maxStack: 1,
      properties: { bonus_hp: 5, slot: "ring" },
    };
    const item = createItemInstance("test:ring", def);
    expect(item.properties).toEqual({ bonus_hp: 5, slot: "ring" });
  });
});

describe("addItemToStacks", () => {
  const swordDef: ItemDefinition = {
    name: "Iron Sword",
    type: "weapon",
    description: "A sword.",
    stackable: false,
    maxStack: 1,
  };

  const potionDef: ItemDefinition = {
    name: "Health Potion",
    type: "consumable",
    description: "Heals.",
    stackable: true,
    maxStack: 10,
  };

  function makeInstance(overrides: Partial<ItemInstance> = {}): ItemInstance {
    return {
      instanceId: generateItemId(),
      definitionId: "area:item",
      name: "Item",
      quantity: 1,
      properties: {},
      ...overrides,
    };
  }

  test("stackable items merge into an existing stack", () => {
    const stacks: ItemInstance[] = [];
    addItemToStacks(stacks, makeInstance({ definitionId: "area:potion", quantity: 3 }), potionDef);
    addItemToStacks(stacks, makeInstance({ definitionId: "area:potion", quantity: 2 }), potionDef);

    expect(stacks).toHaveLength(1);
    expect(stacks[0].quantity).toBe(5);
  });

  test("non-stackable items never merge", () => {
    const stacks: ItemInstance[] = [];
    addItemToStacks(stacks, makeInstance({ definitionId: "area:sword" }), swordDef);
    addItemToStacks(stacks, makeInstance({ definitionId: "area:sword" }), swordDef);

    expect(stacks).toHaveLength(2);
  });

  test("a missing definition is treated as non-stackable", () => {
    const stacks: ItemInstance[] = [];
    addItemToStacks(stacks, makeInstance({ definitionId: "area:mystery" }), undefined);
    addItemToStacks(stacks, makeInstance({ definitionId: "area:mystery" }), undefined);

    expect(stacks).toHaveLength(2);
  });

  test("overflow beyond maxStack stays a separate instance", () => {
    const stacks: ItemInstance[] = [];
    addItemToStacks(stacks, makeInstance({ definitionId: "area:potion", quantity: 8 }), potionDef);
    addItemToStacks(stacks, makeInstance({ definitionId: "area:potion", quantity: 5 }), potionDef);

    expect(stacks).toHaveLength(2);
    expect(stacks[0].quantity).toBe(10);
    expect(stacks[1].quantity).toBe(3);
  });
});

describe("splitItemStack", () => {
  function makeInstance(): ItemInstance {
    return {
      instanceId: "original-id",
      definitionId: "area:potion",
      name: "Health Potion",
      quantity: 5,
      properties: { charges: 2 },
    };
  }

  test("mints a fresh instanceId distinct from the source", () => {
    const source = makeInstance();
    const split = splitItemStack(source, 2);

    expect(split.instanceId).not.toBe("original-id");
    expect(split.instanceId).toMatch(/^item_/);
  });

  test("decrements the source quantity and carries the split quantity", () => {
    const source = makeInstance();
    const split = splitItemStack(source, 2);

    expect(source.quantity).toBe(3);
    expect(split.quantity).toBe(2);
  });

  test("clones properties so the split and source are independent", () => {
    const source = makeInstance();
    const split = splitItemStack(source, 2);

    expect(split.properties).toEqual({ charges: 2 });
    expect(split.properties).not.toBe(source.properties);

    (split.properties as { charges: number }).charges = 99;
    expect(source.properties).toEqual({ charges: 2 });
  });
});
