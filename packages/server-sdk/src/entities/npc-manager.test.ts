import { describe, expect, test, spyOn } from "bun:test";
import { NpcManager } from "./npc-manager.js";
import type { NpcDefinition, ItemDefinition } from "@realms/lexicons";

const spiderDef: NpcDefinition = {
  name: "Forest Spider",
  description: "A spider the size of a large dog.",
  behavior: "hostile",
  level: 2,
};

const silkDef: ItemDefinition = {
  name: "Spider Silk",
  type: "material",
  description: "Strong silk.",
  stackable: true,
  maxStack: 20,
};

describe("NpcManager.generateLoot", () => {
  test("drops items registered under prefixed definition ids", () => {
    const manager = new NpcManager();
    manager.registerDefinition("dark-forest:forest-spider", spiderDef, [
      { itemId: "dark-forest:spider-silk", chance: 100 },
    ]);

    const drops = manager.generateLoot("dark-forest:forest-spider", (id) =>
      id === "dark-forest:spider-silk" ? silkDef : undefined,
    );

    expect(drops).toHaveLength(1);
    expect(drops[0].definitionId).toBe("dark-forest:spider-silk");
    expect(drops[0].name).toBe("Spider Silk");
  });

  test("warns and drops nothing when a loot item definition is unknown", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const manager = new NpcManager();
      manager.registerDefinition("dark-forest:forest-spider", spiderDef, [
        { itemId: "spider-silk", chance: 100 },
      ]);

      const drops = manager.generateLoot("dark-forest:forest-spider", () => undefined);

      expect(drops).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0].map(String).join(" ");
      expect(message).toContain("dark-forest:forest-spider");
      expect(message).toContain("spider-silk");
    } finally {
      warn.mockRestore();
    }
  });
});
