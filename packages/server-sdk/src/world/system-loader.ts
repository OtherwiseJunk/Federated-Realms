import { parse as parseYaml } from "yaml";
import type { GameSystem } from "@realms/common";
import type {
  AttributeDef,
  ClassDef,
  RaceDef,
  FormulaDef,
  EquipSlotDef,
  ItemTypeDef,
  SpellDef,
} from "@realms/lexicons";

interface SystemYaml {
  attributes: Record<string, AttributeDef>;
  classes: Record<string, ClassDef>;
  races: Record<string, RaceDef>;
  formulas: Record<string, FormulaDef>;
  equipSlots: Record<string, EquipSlotDef>;
  itemTypes: Record<string, ItemTypeDef>;
  spells: Record<string, SpellDef>;
}

export async function loadGameSystem(dataPath: string): Promise<GameSystem> {
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
    formulas: raw.formulas ?? {},
    equipSlots: raw.equipSlots ?? {},
    itemTypes: raw.itemTypes ?? {},
    spells: raw.spells ?? {},
  };

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
