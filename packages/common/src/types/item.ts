import type { ItemDefinition, ItemProperties } from "@realms/lexicons";

/** An item instance in a player's inventory or on the ground */
export interface ItemInstance {
  instanceId: string;
  definitionId: string;
  name: string;
  quantity: number;
  properties?: ItemProperties;
}

/** A collection of item definitions keyed by definition ID */
export type ItemRegistry = Map<string, ItemDefinition>;

/** Generate a unique item instance ID */
export function generateItemId(): string {
  return `item_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Create an item instance from a definition */
export function createItemInstance(
  definitionId: string,
  definition: ItemDefinition,
  quantity: number = 1,
): ItemInstance {
  return {
    instanceId: generateItemId(),
    definitionId,
    name: definition.name,
    quantity: Math.min(quantity, definition.maxStack),
    properties: definition.properties ? { ...definition.properties } : undefined,
  };
}

/**
 * Add an item into a stack list, merging into an existing stack when the item's
 * definition is stackable (respecting maxStack). Quantity that overflows the
 * cap is appended as a separate instance. Non-stackable items — or items whose
 * definition is unknown — are always appended without merging.
 */
export function addItemToStacks(
  stacks: ItemInstance[],
  item: ItemInstance,
  definition: ItemDefinition | undefined,
): void {
  if (definition?.stackable) {
    const existing = stacks.find(
      (i) => i.definitionId === item.definitionId && i.quantity < definition.maxStack,
    );
    if (existing) {
      const room = definition.maxStack - existing.quantity;
      const merged = Math.min(room, item.quantity);
      existing.quantity += merged;
      const overflow = item.quantity - merged;
      if (overflow > 0) {
        stacks.push({ ...item, quantity: overflow });
      }
      return;
    }
  }
  stacks.push({ ...item });
}

/**
 * Split `quantity` off an existing stack. Mutates the source's quantity and
 * returns a NEW instance with a fresh instanceId and a cloned properties object
 * so the two stacks never share mutable state. Callers ensure quantity is less
 * than the source quantity (a full remove returns the source instance itself).
 */
export function splitItemStack(item: ItemInstance, quantity: number): ItemInstance {
  item.quantity -= quantity;
  return {
    instanceId: generateItemId(),
    definitionId: item.definitionId,
    name: item.name,
    quantity,
    properties: item.properties ? { ...item.properties } : undefined,
  };
}
