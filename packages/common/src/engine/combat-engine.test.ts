import { describe, expect, test } from "bun:test";
import {
  rollD20,
  rollDice,
  attrMod,
  getEquipSlot,
  buildSlotAliases,
  getEquippedDefense,
  getWeaponDamage,
  getWeaponName,
  resolvePlayerAttack,
  resolveNpcAttack,
  calculateXpReward,
  xpForLevel,
  xpToNextLevel,
  checkLevelUp,
  attemptFlee,
  formatAttackResult,
  resolveSpellSelf,
} from "./combat-engine.ts";
import type { EquipmentConfig } from "./combat-engine.ts";
import type { SpellDef } from "@realms/lexicons";

// ── Test config matching the default fantasy system.yml ──

const config: EquipmentConfig = {
  equipSlots: {
    mainHand: {
      name: "Main Hand",
      category: "weapon",
      aliases: ["weapon", "main hand", "mainhand"],
    },
    offHand: { name: "Off Hand", category: "weapon", aliases: ["shield", "off hand", "offhand"] },
    head: { name: "Head", category: "armor", aliases: ["helmet", "hat", "helm"] },
    body: { name: "Body", category: "armor", aliases: ["armor", "chest", "torso"] },
    feet: { name: "Feet", category: "armor", aliases: ["boots", "shoes"] },
    ring: { name: "Ring", category: "accessory", aliases: ["finger"] },
  },
  itemTypes: {
    weapon: { name: "Weapon", equippable: true, defaultSlot: "mainHand" },
    armor: {
      name: "Armor",
      equippable: true,
      defaultSlot: "body",
      equipSlots: ["head", "body", "feet", "offHand"],
    },
    accessory: { name: "Accessory", equippable: true, defaultSlot: "ring", equipSlots: ["ring"] },
    consumable: { name: "Consumable", stackable: true },
    material: { name: "Material", stackable: true },
    key: { name: "Key" },
  },
};

describe("dice", () => {
  test("rollD20 returns 1-20", () => {
    for (let i = 0; i < 100; i++) {
      const roll = rollD20();
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(20);
    }
  });

  test("rollDice returns correct range", () => {
    for (let i = 0; i < 100; i++) {
      const roll = rollDice(2, 6); // 2d6: 2-12
      expect(roll).toBeGreaterThanOrEqual(2);
      expect(roll).toBeLessThanOrEqual(12);
    }
  });

  test("rollDice caps oversized count and sides", () => {
    expect(rollDice(999999999, 9)).toBeLessThanOrEqual(100 * 9);
    expect(rollDice(100, 999999)).toBeLessThanOrEqual(100 * 1000);
  });
});

describe("spell dice notation", () => {
  // wis 10 → cast mod 0, so amount = power (10) + dice roll
  const attrs = { wis: 10 };

  function makeSpell(dice: string): SpellDef {
    return {
      name: "Test Spell",
      description: "A spell for testing",
      mpCost: 1,
      attribute: "wis",
      effect: "heal",
      power: 10,
      target: "self",
      dice,
    };
  }

  test("oversized dice count is ignored like invalid notation", () => {
    expect(resolveSpellSelf(makeSpell("999999999d9"), attrs).amount).toBe(10);
  });

  test("oversized dice sides are ignored like invalid notation", () => {
    expect(resolveSpellSelf(makeSpell("2d999999"), attrs).amount).toBe(10);
  });

  test("zero-count and zero-sided dice are ignored", () => {
    expect(resolveSpellSelf(makeSpell("0d6"), attrs).amount).toBe(10);
    expect(resolveSpellSelf(makeSpell("3d0"), attrs).amount).toBe(10);
  });

  test("dice at the caps still roll", () => {
    const result = resolveSpellSelf(makeSpell("100d1000"), attrs);
    expect(result.amount).toBeGreaterThanOrEqual(10 + 100);
    expect(result.amount).toBeLessThanOrEqual(10 + 100 * 1000);
  });

  test("normal dice notation still rolls", () => {
    for (let i = 0; i < 100; i++) {
      const result = resolveSpellSelf(makeSpell("2d6"), attrs);
      expect(result.amount).toBeGreaterThanOrEqual(12);
      expect(result.amount).toBeLessThanOrEqual(22);
    }
  });

  test("invalid notation is ignored", () => {
    for (const dice of ["abc", "2d6+3", "d6", "2d", "-1d6", "2 d6"]) {
      expect(resolveSpellSelf(makeSpell(dice), attrs).amount).toBe(10);
    }
  });
});

describe("attrMod", () => {
  test("standard attribute modifiers", () => {
    expect(attrMod(10)).toBe(0);
    expect(attrMod(11)).toBe(0);
    expect(attrMod(12)).toBe(1);
    expect(attrMod(14)).toBe(2);
    expect(attrMod(16)).toBe(3);
    expect(attrMod(8)).toBe(-1);
    expect(attrMod(6)).toBe(-2);
    expect(attrMod(20)).toBe(5);
  });
});

describe("equipment helpers", () => {
  test("getEquipSlot for weapons", () => {
    expect(getEquipSlot(config, "weapon", {}, ["melee"])).toBe("mainHand");
    expect(getEquipSlot(config, "weapon", {}, ["ranged"])).toBe("mainHand");
  });

  test("getEquipSlot for armor", () => {
    expect(getEquipSlot(config, "armor", { slot: "head" }, ["head"])).toBe("head");
    expect(getEquipSlot(config, "armor", { slot: "body" }, ["body"])).toBe("body");
    expect(getEquipSlot(config, "armor", {}, ["offHand"])).toBe("offHand");
    expect(getEquipSlot(config, "armor", {}, [])).toBe("body"); // default armor slot
  });

  test("getEquipSlot for armor via tags", () => {
    expect(getEquipSlot(config, "armor", {}, ["head"])).toBe("head");
    expect(getEquipSlot(config, "armor", {}, ["feet"])).toBe("feet");
  });

  test("getEquipSlot returns null for non-equippables", () => {
    expect(getEquipSlot(config, "consumable", {}, [])).toBeNull();
    expect(getEquipSlot(config, "material", {}, [])).toBeNull();
    expect(getEquipSlot(config, "key", {}, [])).toBeNull();
  });

  test("getEquipSlot returns null for unknown types", () => {
    expect(getEquipSlot(config, "cyberdeck", {}, [])).toBeNull();
  });

  test("getEquipSlot explicit slot in properties takes priority", () => {
    expect(getEquipSlot(config, "armor", { slot: "feet" }, ["head"])).toBe("feet");
  });

  test("getEquipSlot respects item type slot restrictions", () => {
    // Accessory can only go in "ring" — tag "head" won't match even though it's a valid slot
    expect(getEquipSlot(config, "accessory", {}, ["head"])).toBe("ring");
  });

  test("buildSlotAliases maps all aliases", () => {
    const aliases = buildSlotAliases(config);
    expect(aliases["weapon"]).toBe("mainHand");
    expect(aliases["mainhand"]).toBe("mainHand");
    expect(aliases["main hand"]).toBe("mainHand");
    expect(aliases["shield"]).toBe("offHand");
    expect(aliases["helmet"]).toBe("head");
    expect(aliases["armor"]).toBe("body");
    expect(aliases["boots"]).toBe("feet");
    expect(aliases["finger"]).toBe("ring");
    // Slot IDs themselves
    expect(aliases["mainhand"]).toBe("mainHand");
    expect(aliases["head"]).toBe("head");
    expect(aliases["ring"]).toBe("ring");
  });

  test("getEquippedDefense sums all armor", () => {
    const eq = {
      head: {
        instanceId: "1",
        definitionId: "cap",
        name: "Cap",
        quantity: 1,
        properties: { defense: 1 },
      },
      body: {
        instanceId: "2",
        definitionId: "armor",
        name: "Armor",
        quantity: 1,
        properties: { defense: 3 },
      },
      mainHand: {
        instanceId: "3",
        definitionId: "sword",
        name: "Sword",
        quantity: 1,
        properties: { damage: 5 },
      },
    };
    expect(getEquippedDefense(eq)).toBe(4); // 1 + 3
  });

  test("getWeaponDamage returns weapon damage or 1 for fists", () => {
    expect(getWeaponDamage({})).toBe(1); // unarmed
    expect(
      getWeaponDamage({
        mainHand: {
          instanceId: "1",
          definitionId: "s",
          name: "Sword",
          quantity: 1,
          properties: { damage: 5 },
        },
      }),
    ).toBe(5);
  });

  test("getWeaponName returns weapon name or fists", () => {
    expect(getWeaponName({})).toBe("fists");
    expect(
      getWeaponName({
        mainHand: { instanceId: "1", definitionId: "s", name: "Rusty Sword", quantity: 1 },
      }),
    ).toBe("Rusty Sword");
  });
});

describe("equipment with custom system", () => {
  const sciFiConfig: EquipmentConfig = {
    equipSlots: {
      cranial: { name: "Cranial Implant", category: "implant" },
      cyberdeck: { name: "Cyberdeck", category: "tech" },
      exosuit: { name: "Exosuit", category: "armor" },
    },
    itemTypes: {
      implant: {
        name: "Implant",
        equippable: true,
        defaultSlot: "cranial",
        equipSlots: ["cranial"],
      },
      tech: { name: "Tech", equippable: true, defaultSlot: "cyberdeck" },
      armor: { name: "Armor", equippable: true, defaultSlot: "exosuit" },
    },
  };

  test("sci-fi system resolves custom slots", () => {
    expect(getEquipSlot(sciFiConfig, "implant", {}, [])).toBe("cranial");
    expect(getEquipSlot(sciFiConfig, "tech", {}, [])).toBe("cyberdeck");
    expect(getEquipSlot(sciFiConfig, "armor", {}, [])).toBe("exosuit");
  });

  test("sci-fi system rejects fantasy types", () => {
    expect(getEquipSlot(sciFiConfig, "weapon", {}, [])).toBeNull();
  });
});

describe("attack resolution", () => {
  test("resolvePlayerAttack returns valid result", () => {
    const result = resolvePlayerAttack({ str: 14, dex: 10 }, {}, { str: 10, dex: 12 }, 2);
    expect(result.roll).toBeGreaterThanOrEqual(1);
    expect(result.roll).toBeLessThanOrEqual(20);
    expect(result.attackBonus).toBe(2); // max(floor((14-10)/2), floor((10-10)/2)) = max(2, 0)
    expect(result.defense).toBe(11); // 10 + floor((12-10)/2)
    expect(typeof result.hit).toBe("boolean");
    expect(typeof result.damage).toBe("number");
    expect(result.weaponName).toBe("fists");
  });

  test("critical hit on natural 20 always hits", () => {
    // Run many times to eventually get a crit
    let gotCrit = false;
    for (let i = 0; i < 1000; i++) {
      const result = resolvePlayerAttack({ str: 10 }, {}, { dex: 30 }, 10);
      if (result.critical) {
        expect(result.hit).toBe(true);
        expect(result.damage).toBeGreaterThan(0);
        gotCrit = true;
        break;
      }
    }
    // With 1000 tries, P(no crit) = (19/20)^1000 ≈ 0
    expect(gotCrit).toBe(true);
  });

  test("resolveNpcAttack uses NPC level for bonus", () => {
    const result = resolveNpcAttack({ str: 12, dex: 14 }, 2, "Wolf", { str: 10, dex: 10 }, {});
    expect(result.attackBonus).toBe(3); // dexMod(14)=2 + floor(2/2)=1
    expect(result.defense).toBe(10); // 10 + dexMod(10)=0 + 0 armor
  });

  test("resolveNpcAttack folds an explicit AC bonus into defense", () => {
    const withoutBonus = resolveNpcAttack(
      { str: 12, dex: 14 },
      2,
      "Wolf",
      { str: 10, dex: 10 },
      {},
    );
    const withBonus = resolveNpcAttack(
      { str: 12, dex: 14 },
      2,
      "Wolf",
      { str: 10, dex: 10 },
      {},
      4,
    );
    expect(withBonus.defense).toBe(withoutBonus.defense + 4);
  });

  test("acBonus 4 matches the legacy dex+8 defend encoding", () => {
    // Legacy defend path bumped dex by 8 (attrMod(+8)/2 = +4 AC). The explicit
    // acBonus of 4 must produce the identical player defense.
    const legacyDefense = resolveNpcAttack(
      { dex: 12 },
      1,
      "Wolf",
      { dex: 10 + 8 }, // base dex 10, defend applied as +8 dex
      {},
    ).defense;
    const explicitDefense = resolveNpcAttack(
      { dex: 12 },
      1,
      "Wolf",
      { dex: 10 }, // unmutated base dex
      {},
      4,
    ).defense;
    expect(explicitDefense).toBe(legacyDefense);
  });

  test("resolveNpcAttack defaults acBonus to 0", () => {
    const result = resolveNpcAttack({ dex: 12 }, 1, "Wolf", { dex: 10 }, {});
    expect(result.defense).toBe(10); // 10 + dexMod(10)=0 + 0 armor + 0 acBonus
  });
});

describe("XP and leveling", () => {
  test("xpForLevel thresholds", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(3)).toBe(300);
    expect(xpForLevel(4)).toBe(600);
    expect(xpForLevel(5)).toBe(1000);
  });

  test("xpToNextLevel calculates remaining XP", () => {
    expect(xpToNextLevel(1, 0)).toBe(100);
    expect(xpToNextLevel(1, 50)).toBe(50);
    expect(xpToNextLevel(1, 100)).toBe(0); // ready to level up
    expect(xpToNextLevel(2, 200)).toBe(100); // need 300 for level 3
  });

  test("checkLevelUp returns correct level", () => {
    expect(checkLevelUp(1, 0)).toBe(1);
    expect(checkLevelUp(1, 99)).toBe(1);
    expect(checkLevelUp(1, 100)).toBe(2);
    expect(checkLevelUp(1, 300)).toBe(3);
    expect(checkLevelUp(1, 999)).toBe(4);
    expect(checkLevelUp(1, 1000)).toBe(5);
  });

  test("calculateXpReward scales with level difference", () => {
    const sameLevel = calculateXpReward(2, 2);
    const higherNpc = calculateXpReward(4, 2);
    const lowerNpc = calculateXpReward(1, 3);

    expect(sameLevel).toBe(30); // 2 * 15
    expect(higherNpc).toBeGreaterThan(sameLevel);
    expect(lowerNpc).toBeLessThan(sameLevel);
    expect(lowerNpc).toBeGreaterThan(0);
  });
});

describe("flee", () => {
  test("attemptFlee returns boolean", () => {
    const result = attemptFlee(14, 2);
    expect(typeof result).toBe("boolean");
  });

  test("higher dex makes fleeing easier", () => {
    // Statistical test: high dex should succeed more than low dex
    let highDexSuccesses = 0;
    let lowDexSuccesses = 0;
    const trials = 1000;

    for (let i = 0; i < trials; i++) {
      if (attemptFlee(20, 2)) highDexSuccesses++;
      if (attemptFlee(6, 2)) lowDexSuccesses++;
    }

    expect(highDexSuccesses).toBeGreaterThan(lowDexSuccesses);
  });
});

describe("formatAttackResult", () => {
  test("formats hit correctly", () => {
    const result = formatAttackResult(
      "Hero",
      "Goblin",
      {
        hit: true,
        critical: false,
        roll: 15,
        attackBonus: 3,
        totalAttack: 18,
        defense: 12,
        damage: 7,
        weaponName: "Sword",
      },
      13,
      20,
    );
    expect(result).toContain("Hero attacks Goblin with Sword");
    expect(result).toContain("18 vs AC 12");
    expect(result).toContain("Hit!");
    expect(result).toContain("7 damage");
    expect(result).toContain("13/20");
  });

  test("formats miss correctly", () => {
    const result = formatAttackResult(
      "Hero",
      "Goblin",
      {
        hit: false,
        critical: false,
        roll: 3,
        attackBonus: 1,
        totalAttack: 4,
        defense: 14,
        damage: 0,
        weaponName: "fists",
      },
      20,
      20,
    );
    expect(result).toContain("misses");
    expect(result).toContain("Miss!");
  });

  test("formats critical hit", () => {
    const result = formatAttackResult(
      "Hero",
      "Dragon",
      {
        hit: true,
        critical: true,
        roll: 20,
        attackBonus: 5,
        totalAttack: 25,
        defense: 18,
        damage: 14,
        weaponName: "Greatsword",
      },
      86,
      100,
    );
    expect(result).toContain("CRITICAL HIT");
    expect(result).toContain("14 damage");
  });
});
