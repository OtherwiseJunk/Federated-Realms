import { describe, expect, test } from "bun:test";
import { CharacterSession } from "./character-session.js";
import type { CharacterProfile, FormulaDef, ItemDefinition } from "@realms/lexicons";
import type { ItemInstance } from "@realms/common";

const SWORD_DEF: ItemDefinition = {
  name: "Iron Sword",
  type: "weapon",
  description: "A sword.",
  stackable: false,
  maxStack: 1,
};

const POTION_DEF: ItemDefinition = {
  name: "Health Potion",
  type: "consumable",
  description: "Heals.",
  stackable: true,
  maxStack: 10,
};

const FORMULAS: Record<string, FormulaDef> = {
  maxHp: { name: "Max HP", expression: "20 + (level - 1) * 8 + floor(con / 2)", min: 1 },
  maxMp: { name: "Max MP", expression: "10 + (level - 1) * 4 + floor(int / 3)", min: 0 },
  maxAp: { name: "Max AP", expression: "4 + floor((dex - 10) / 4)", min: 2, max: 12 },
};

function makeProfile(overrides: Partial<CharacterProfile> = {}): CharacterProfile {
  return {
    name: "TestHero",
    class: "warrior",
    race: "human",
    level: 1,
    experience: 0,
    attributes: { str: 14, dex: 12, con: 13, int: 10, wis: 10, cha: 12 },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSession(
  profileOverrides: Partial<CharacterProfile> = {},
  formulas: Record<string, FormulaDef> = FORMULAS,
): CharacterSession {
  return new CharacterSession(
    "session-1",
    "did:plc:test",
    makeProfile(profileOverrides),
    "test-area:spawn",
    formulas,
  );
}

function makeItem(overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    instanceId: "item-1",
    definitionId: "area:sword",
    name: "Iron Sword",
    quantity: 1,
    properties: {},
    ...overrides,
  };
}

describe("CharacterSession", () => {
  describe("construction", () => {
    test("initializes with correct metadata", () => {
      const session = makeSession();
      expect(session.sessionId).toBe("session-1");
      expect(session.characterDid).toBe("did:plc:test");
      expect(session.name).toBe("TestHero");
      expect(session.currentRoom).toBe("test-area:spawn");
    });

    test("tracks spawn room as visited", () => {
      const session = makeSession();
      expect(session.visitedRooms.has("test-area:spawn")).toBe(true);
    });

    test("starts without combat or connection", () => {
      const session = makeSession();
      expect(session.inCombat).toBe(false);
      expect(session.isConnected).toBe(false);
      expect(session.isDead).toBe(false);
    });

    test("missing derived-stat formulas are normalized to defaults", () => {
      const session = makeSession({}, {});
      // Defaults match the reference system.yml (con 13, int 10, dex 12, level 1)
      expect(session.state.maxHp).toBe(26); // 20 + 0 + floor(13 / 2)
      expect(session.state.maxMp).toBe(13); // 10 + 0 + floor(10 / 3)
      expect(session.state.maxAp).toBe(4); // 4 + floor((12 - 10) / 4)
      expect(session.state.currentHp).toBe(26);
    });

    test("partial formulas keep provided entries and default the rest", () => {
      const session = makeSession({}, { maxHp: { name: "Max HP", expression: "100", min: 1 } });
      expect(session.state.maxHp).toBe(100);
      expect(session.state.maxMp).toBe(13); // default
      expect(session.state.maxAp).toBe(4); // default
    });
  });

  describe("inventory", () => {
    test("add and find items", () => {
      const session = makeSession();
      session.addItem(makeItem(), SWORD_DEF);

      expect(session.findItem("Iron Sword")).toBeDefined();
      expect(session.findItem("sword")).toBeDefined();
      expect(session.findItem("item-1")).toBeDefined();
      expect(session.findItem("missing")).toBeUndefined();
    });

    test("non-stackable items never merge", () => {
      const session = makeSession();
      session.addItem(makeItem(), SWORD_DEF);
      session.addItem(makeItem({ instanceId: "item-2" }), SWORD_DEF);

      expect(session.inventory).toHaveLength(2);
    });

    test("stackable items merge by definitionId up to maxStack", () => {
      const session = makeSession();
      const potion = makeItem({ definitionId: "area:potion", name: "Health Potion" });
      session.addItem({ ...potion, quantity: 2 }, POTION_DEF);
      session.addItem({ ...potion, instanceId: "item-2", quantity: 3 }, POTION_DEF);

      expect(session.inventory).toHaveLength(1);
      expect(session.inventory[0].quantity).toBe(5);
    });

    test("removeItem removes full stack", () => {
      const session = makeSession();
      session.addItem(makeItem({ quantity: 3 }), SWORD_DEF);

      const removed = session.removeItem("Iron Sword", 5);
      expect(removed?.quantity).toBe(3);
      expect(session.inventory).toHaveLength(0);
    });

    test("removeItem partial stack mints a fresh instance with independent properties", () => {
      const session = makeSession();
      session.addItem(makeItem({ quantity: 5, properties: { charges: 2 } }), SWORD_DEF);

      const removed = session.removeItem("Iron Sword", 2);
      expect(removed?.quantity).toBe(2);
      expect(session.inventory[0].quantity).toBe(3);
      expect(removed?.instanceId).not.toBe("item-1");

      (removed!.properties as { charges: number }).charges = 99;
      expect(session.inventory[0].properties).toEqual({ charges: 2 });
    });

    test("removeItem returns undefined for missing items", () => {
      const session = makeSession();
      expect(session.removeItem("missing")).toBeUndefined();
    });

    test("countItem returns quantity by definitionId", () => {
      const session = makeSession();
      expect(session.countItem("area:sword")).toBe(0);
      session.addItem(makeItem({ quantity: 7 }), SWORD_DEF);
      expect(session.countItem("area:sword")).toBe(7);
    });

    test("removeItemByDefId removes by definitionId", () => {
      const session = makeSession();
      session.addItem(makeItem({ quantity: 5 }), SWORD_DEF);

      expect(session.removeItemByDefId("area:sword", 3)).toBe(true);
      expect(session.inventory[0].quantity).toBe(2);

      expect(session.removeItemByDefId("area:sword", 5)).toBe(true);
      expect(session.inventory).toHaveLength(0);

      expect(session.removeItemByDefId("area:sword", 1)).toBe(false);
    });
  });

  describe("equipment", () => {
    test("equip and unequip items", () => {
      const session = makeSession();
      const sword = makeItem();

      const prev = session.equip("mainHand", sword);
      expect(prev).toBeUndefined();
      expect(session.getEquipped("mainHand")?.name).toBe("Iron Sword");

      const removed = session.unequip("mainHand");
      expect(removed?.name).toBe("Iron Sword");
      expect(session.getEquipped("mainHand")).toBeUndefined();
    });

    test("equipping replaces existing item", () => {
      const session = makeSession();
      session.equip("mainHand", makeItem({ name: "Old Sword" }));

      const replaced = session.equip(
        "mainHand",
        makeItem({ instanceId: "item-2", name: "New Sword" }),
      );
      expect(replaced?.name).toBe("Old Sword");
      expect(session.getEquipped("mainHand")?.name).toBe("New Sword");
    });

    test("equip/unequip does not compound bonuses when formulas are missing", () => {
      const session = makeSession({}, {});
      const hpBefore = session.state.maxHp;
      const ring = makeItem({
        instanceId: "ring-1",
        name: "Ring of Vitality",
        properties: { bonus_hp: 10 },
      });

      session.equip("ring", ring);
      expect(session.state.maxHp).toBe(hpBefore + 10);

      session.unequip("ring");
      expect(session.state.maxHp).toBe(hpBefore);

      session.equip("ring", ring);
      expect(session.state.maxHp).toBe(hpBefore + 10);

      session.unequip("ring");
      expect(session.state.maxHp).toBe(hpBefore);
    });

    test("repeated recalculation while equipped is idempotent", () => {
      const session = makeSession({}, {});
      const hpBefore = session.state.maxHp;

      session.equip(
        "ring",
        makeItem({
          instanceId: "ring-1",
          name: "Ring of Vitality",
          properties: { bonus_hp: 10 },
        }),
      );
      expect(session.state.maxHp).toBe(hpBefore + 10);

      // Effect expiry triggers recalculateDerived (same path as tickEffects in play)
      for (let i = 0; i < 3; i++) {
        session.state.activeEffects = [
          {
            id: `fx-${i}`,
            name: "Blink",
            type: "buff",
            attribute: "wis",
            magnitude: 0,
            remainingTicks: 1,
          },
        ];
        session.tickEffects();
        expect(session.state.maxHp).toBe(hpBefore + 10);
      }
    });

    test("equipment bonuses affect derived stats", () => {
      const session = makeSession();
      const hpBefore = session.state.maxHp;

      session.equip(
        "ring",
        makeItem({
          instanceId: "ring-1",
          name: "Ring of Vitality",
          properties: { bonus_hp: 10 },
        }),
      );

      expect(session.state.maxHp).toBe(hpBefore + 10);

      session.unequip("ring");
      expect(session.state.maxHp).toBe(hpBefore);
    });
  });

  describe("gold", () => {
    test("add and spend gold", () => {
      const session = makeSession();
      const startGold = session.gold;

      session.addGold(100);
      expect(session.gold).toBe(startGold + 100);

      expect(session.spendGold(30)).toBe(true);
      expect(session.gold).toBe(startGold + 70);

      expect(session.spendGold(startGold + 100)).toBe(false);
      expect(session.gold).toBe(startGold + 70);
    });
  });

  describe("combat", () => {
    test("AP spending", () => {
      const session = makeSession();
      session.refreshAp();
      const maxAp = session.state.maxAp;

      expect(session.spendAp(2)).toBe(true);
      expect(session.state.currentAp).toBe(maxAp - 2);

      expect(session.spendAp(maxAp)).toBe(false);
    });

    test("take damage and heal", () => {
      const session = makeSession();
      const maxHp = session.state.maxHp;

      session.takeDamage(10);
      expect(session.state.currentHp).toBe(maxHp - 10);

      session.heal(5);
      expect(session.state.currentHp).toBe(maxHp - 5);

      // Heal doesn't exceed max
      session.heal(1000);
      expect(session.state.currentHp).toBe(maxHp);
    });

    test("damage doesn't go below 0", () => {
      const session = makeSession();
      session.takeDamage(9999);
      expect(session.state.currentHp).toBe(0);
      expect(session.isDead).toBe(true);
    });

    test("mana restore capped at max", () => {
      const session = makeSession();
      session.state.currentMp = 0;
      session.restoreMana(9999);
      expect(session.state.currentMp).toBe(session.state.maxMp);
    });

    test("combat target tracking", () => {
      const session = makeSession();
      expect(session.inCombat).toBe(false);

      session.combatTarget = "npc-1";
      expect(session.inCombat).toBe(true);

      session.combatTarget = null;
      expect(session.inCombat).toBe(false);
    });
  });

  describe("XP and leveling", () => {
    test("addXp accumulates experience", () => {
      const session = makeSession();
      session.addXp(50);
      expect(session.state.experience).toBe(50);
    });

    test("levels up when XP threshold is met", () => {
      const session = makeSession();
      // Level 2 requires: 2 * 1 * 50 = 100 XP
      const newLevel = session.addXp(100);
      expect(newLevel).toBe(2);
      expect(session.state.level).toBe(2);
    });

    test("does not level up below threshold", () => {
      const session = makeSession();
      const newLevel = session.addXp(99);
      expect(newLevel).toBeNull();
      expect(session.state.level).toBe(1);
    });

    test("can gain multiple levels at once", () => {
      const session = makeSession();
      // Level 3 requires: 3 * 2 * 50 = 300 XP
      const newLevel = session.addXp(300);
      expect(newLevel).toBe(3);
      expect(session.state.level).toBe(3);
    });

    test("level up restores HP and MP to max", () => {
      const session = makeSession();
      session.takeDamage(10);
      session.state.currentMp = 0;

      session.addXp(100);
      expect(session.state.currentHp).toBe(session.state.maxHp);
      expect(session.state.currentMp).toBe(session.state.maxMp);
    });
  });

  describe("respawn", () => {
    test("respawn resets position and restores partial HP/MP", () => {
      const session = makeSession();
      session.currentRoom = "some-room";
      session.takeDamage(9999);
      session.combatTarget = "npc-1";
      session.isDefending = true;

      session.respawn("test-area:spawn");

      expect(session.currentRoom).toBe("test-area:spawn");
      expect(session.state.currentHp).toBeGreaterThan(0);
      expect(session.state.currentHp).toBeLessThanOrEqual(Math.floor(session.state.maxHp * 0.25));
      expect(session.combatTarget).toBeNull();
      expect(session.isDefending).toBe(false);
    });
  });

  describe("effects", () => {
    test("tickEffects decrements and expires effects", () => {
      const session = makeSession();
      const baseDex = session.state.attributes.dex;

      session.state.activeEffects = [
        {
          id: "speed-boost",
          name: "Speed Boost",
          type: "buff",
          attribute: "dex",
          magnitude: 4,
          remainingTicks: 2,
        },
      ];
      session.state.attributes.dex += 4;

      let expired = session.tickEffects();
      expect(expired).toEqual([]);
      expect(session.state.activeEffects).toHaveLength(1);

      expired = session.tickEffects();
      expect(expired).toEqual(["Speed Boost"]);
      expect(session.state.activeEffects).toHaveLength(0);
      expect(session.state.attributes.dex).toBe(baseDex);
    });
  });
});

describe("CharacterSession.regenAp", () => {
  test("regenerates 1 AP per tick when the system defines no apRegen formula", () => {
    const session = makeSession(); // FORMULAS has no apRegen, con 13
    session.state.currentAp = 0;
    expect(session.regenAp()).toBe(true);
    expect(session.state.currentAp).toBe(1);
  });

  test("uses the apRegen formula when the system defines one", () => {
    const session = makeSession(
      {},
      {
        ...FORMULAS,
        apRegen: { name: "AP Regen", expression: "1 + floor((con - 10) / 4)", min: 1 },
      },
    ); // con 13 -> 1 + floor(3/4) = 1
    session.state.attributes.con = 18; // 1 + floor(8/4) = 3
    session.state.currentAp = 0;
    session.regenAp();
    expect(session.state.currentAp).toBe(3);
  });

  test("caps at maxAp and reports no change when already full", () => {
    const session = makeSession();
    session.state.currentAp = session.state.maxAp;
    expect(session.regenAp()).toBe(false);
    expect(session.state.currentAp).toBe(session.state.maxAp);
  });
});
