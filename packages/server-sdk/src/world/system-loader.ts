import { parse as parseYaml } from "yaml";
import { withDefaultFormulas, type GameSystem } from "@realms/common";
import { assertEnumValue, SPELL_EFFECTS, SPELL_TARGETS } from "@realms/lexicons";
import type {
  AttributeDef,
  ClassDef,
  RaceDef,
  FormulaDef,
  EquipSlotDef,
  ItemTypeDef,
  SpellDef,
} from "@realms/lexicons";

// Every section is optional: a system.yml may omit any of them, and each is
// resolved to `{}` at the single `?? {}` point below.
interface SystemYaml {
  attributes?: Record<string, AttributeDef>;
  classes?: Record<string, ClassDef>;
  races?: Record<string, RaceDef>;
  formulas?: Record<string, FormulaDef>;
  equipSlots?: Record<string, EquipSlotDef>;
  itemTypes?: Record<string, ItemTypeDef>;
  spells?: Record<string, SpellDef>;
  weightScale?: number;
}

export async function loadGameSystem(
  dataPath: string,
  requiredAttributes: readonly string[] = [],
): Promise<GameSystem> {
  const file = Bun.file(`${dataPath}/system.yml`);
  if (!(await file.exists())) {
    throw new Error(`Game system file not found: ${dataPath}/system.yml`);
  }

  const text = await file.text();
  const raw: SystemYaml = parseYaml(text);

  const system: GameSystem = {
    attributes: raw.attributes ?? {},
    classes: raw.classes ?? {},
    races: raw.races ?? {},
    // Guarantee a formula exists for every core derived stat. Systems that omit
    // maxHp/maxMp/maxAp inherit the reference defaults so derived-stat consumers
    // never fall back to already-mutated current values (issue #81).
    formulas: withDefaultFormulas(raw.formulas ?? {}),
    equipSlots: raw.equipSlots ?? {},
    itemTypes: raw.itemTypes ?? {},
    spells: raw.spells ?? {},
    // Item weights are stored as integers in 1/weightScale units (atproto has
    // no float type); display divides by this. Defaults to 1 (whole units).
    weightScale: raw.weightScale ?? 1,
  };

  // The combat rules read certain attributes directly with no fallback (since
  // #88), so a system that omits one turns every combat modifier into a silent
  // NaN. The SDK loader is system-agnostic and can't assume any particular
  // attribute names, so the caller passes the set its rules require; fail the
  // boot naming the missing one (issue #95).
  for (const attr of requiredAttributes) {
    if (!Object.hasOwn(system.attributes, attr)) {
      throw new Error(
        `system.yml: required combat attribute "${attr}" is not declared in attributes`,
      );
    }
  }

  // Spell effect/target are open lexicon enums, so a typo would otherwise load a
  // silently broken spell. A spell whose casting attribute isn't declared reads
  // casterAttrs[undefined] → NaN just as silently. Fail the boot with the spell
  // id for context.
  for (const [id, spell] of Object.entries(system.spells)) {
    assertEnumValue(spell.effect, SPELL_EFFECTS, `system.yml: spell "${id}" effect`);
    assertEnumValue(spell.target, SPELL_TARGETS, `system.yml: spell "${id}" target`);
    if (!Object.hasOwn(system.attributes, spell.attribute)) {
      throw new Error(
        `system.yml: spell "${id}" references undeclared attribute "${spell.attribute}"`,
      );
    }
  }

  const attrCount = Object.keys(system.attributes).length;
  const classCount = Object.keys(system.classes).length;
  const raceCount = Object.keys(system.races).length;
  const formulaCount = Object.keys(system.formulas).length;
  const slotCount = Object.keys(system.equipSlots).length;
  const typeCount = Object.keys(system.itemTypes).length;
  const spellCount = Object.keys(system.spells).length;

  console.log(
    `Game system loaded: ${attrCount} attributes, ${classCount} classes, ${raceCount} races, ${formulaCount} formulas, ${slotCount} equip slots, ${typeCount} item types, ${spellCount} spells`,
  );

  return system;
}
