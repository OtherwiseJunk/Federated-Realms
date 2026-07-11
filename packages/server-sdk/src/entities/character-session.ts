import type { CharacterProfile, FormulaDef } from "@realms/lexicons";
import type { CharacterState, ItemInstance } from "@realms/common";
import { profileToState, computeDerivedStats } from "@realms/common";
import type { ServerWebSocket } from "bun";
import { AttestationTracker } from "../atproto/attestation-tracker.js";
import type { ServerIdentity } from "../atproto/server-identity.js";

export interface SessionData {
  sessionId: string;
}

export class CharacterSession {
  readonly sessionId: string;
  readonly characterDid: string;
  readonly state: CharacterState;
  readonly attestations: AttestationTracker;
  ws: ServerWebSocket<SessionData> | null = null;

  combatTarget: string | null = null;
  isDefending: boolean = false;

  readonly visitedRooms = new Set<string>();

  private formulas: Record<string, FormulaDef>;

  constructor(
    sessionId: string,
    characterDid: string,
    profile: CharacterProfile,
    spawnRoom: string,
    formulas: Record<string, FormulaDef> = {},
    serverIdentity?: ServerIdentity,
  ) {
    this.sessionId = sessionId;
    this.characterDid = characterDid;
    this.state = profileToState(profile, spawnRoom, formulas);
    this.formulas = formulas;
    this.visitedRooms.add(spawnRoom);
    this.attestations = new AttestationTracker(
      serverIdentity ?? ({ did: "" } as ServerIdentity),
      characterDid,
    );
  }

  get currentRoom(): string {
    return this.state.currentRoom;
  }

  set currentRoom(roomId: string) {
    this.state.currentRoom = roomId;
  }

  get name(): string {
    return this.state.name;
  }

  get isConnected(): boolean {
    return this.ws !== null;
  }

  get inCombat(): boolean {
    return this.combatTarget !== null;
  }

  send(data: string): void {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(data);
    }
  }

  addItem(item: ItemInstance): void {
    const existing = this.state.inventory.find((i) => i.definitionId === item.definitionId);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      this.state.inventory.push({ ...item });
    }
  }

  removeItem(identifier: string, quantity: number = 1): ItemInstance | undefined {
    const lower = identifier.toLowerCase();
    const index = this.state.inventory.findIndex(
      (i) => i.instanceId === identifier || i.name.toLowerCase().includes(lower),
    );
    if (index === -1) return undefined;

    const item = this.state.inventory[index];
    if (quantity >= item.quantity) {
      this.state.inventory.splice(index, 1);
      return item;
    }

    item.quantity -= quantity;
    return {
      instanceId: item.instanceId,
      definitionId: item.definitionId,
      name: item.name,
      quantity,
      properties: item.properties,
    };
  }

  findItem(identifier: string): ItemInstance | undefined {
    const lower = identifier.toLowerCase();
    return this.state.inventory.find(
      (i) => i.instanceId === identifier || i.name.toLowerCase().includes(lower),
    );
  }

  countItem(definitionId: string): number {
    return this.state.inventory.find((i) => i.definitionId === definitionId)?.quantity ?? 0;
  }

  removeItemByDefId(definitionId: string, quantity: number): boolean {
    const index = this.state.inventory.findIndex((i) => i.definitionId === definitionId);
    if (index === -1) return false;
    const item = this.state.inventory[index];
    if (quantity >= item.quantity) {
      this.state.inventory.splice(index, 1);
    } else {
      item.quantity -= quantity;
    }
    return true;
  }

  get inventory(): ItemInstance[] {
    return this.state.inventory;
  }

  get equipment(): Record<string, ItemInstance> {
    return this.state.equipment;
  }

  equip(slot: string, item: ItemInstance): ItemInstance | undefined {
    const previous = this.state.equipment[slot];
    this.state.equipment[slot] = item;
    this.recalculateDerived();
    return previous;
  }

  unequip(slot: string): ItemInstance | undefined {
    const item = this.state.equipment[slot];
    if (item) {
      delete this.state.equipment[slot];
      this.recalculateDerived();
    }
    return item;
  }

  getEquipped(slot: string): ItemInstance | undefined {
    return this.state.equipment[slot];
  }

  get gold(): number {
    return this.state.gold;
  }

  addGold(amount: number): void {
    this.state.gold += amount;
    this.attestations.recordGoldChange(this.state.gold);
  }

  spendGold(amount: number): boolean {
    if (this.state.gold < amount) return false;
    this.state.gold -= amount;
    return true;
  }

  refreshAp(): void {
    this.state.currentAp = this.state.maxAp;
  }

  spendAp(amount: number): boolean {
    if (this.state.currentAp < amount) return false;
    this.state.currentAp -= amount;
    return true;
  }

  takeDamage(amount: number): void {
    this.state.currentHp = Math.max(0, this.state.currentHp - amount);
  }

  heal(amount: number): void {
    this.state.currentHp = Math.min(this.state.maxHp, this.state.currentHp + amount);
  }

  restoreMana(amount: number): void {
    this.state.currentMp = Math.min(this.state.maxMp, this.state.currentMp + amount);
  }

  get isDead(): boolean {
    return this.state.currentHp <= 0;
  }

  addXp(amount: number): number | null {
    this.state.experience += amount;

    const newLevel = this.checkLevelUp();
    if (newLevel > this.state.level) {
      this.state.level = newLevel;
      this.recalculateDerived();
      this.state.currentHp = this.state.maxHp;
      this.state.currentMp = this.state.maxMp;
      this.attestations.recordLevelUp(newLevel, this.state.experience);
      return newLevel;
    }
    return null;
  }

  private checkLevelUp(): number {
    let level = this.state.level;
    const xpForLevel = (l: number) => l * (l - 1) * 50;
    while (this.state.experience >= xpForLevel(level + 1)) {
      level++;
    }
    return level;
  }

  private recalculateDerived(): void {
    const derived = computeDerivedStats(this.formulas, this.state.level, this.state.attributes);
    const bonuses = this.getEquipmentBonuses();
    this.state.maxHp = (derived.maxHp ?? this.state.maxHp) + (bonuses.hp ?? 0);
    this.state.maxMp = (derived.maxMp ?? this.state.maxMp) + (bonuses.mp ?? 0);
    this.state.maxAp = (derived.maxAp ?? this.state.maxAp) + (bonuses.ap ?? 0);
    this.state.currentHp = Math.min(this.state.currentHp, this.state.maxHp);
    this.state.currentMp = Math.min(this.state.currentMp, this.state.maxMp);
  }

  private getEquipmentBonuses(): { hp: number; mp: number; ap: number } {
    let hp = 0,
      mp = 0,
      ap = 0;
    for (const item of Object.values(this.state.equipment)) {
      if (typeof item.properties?.bonus_hp === "number") hp += item.properties.bonus_hp;
      if (typeof item.properties?.bonus_mp === "number") mp += item.properties.bonus_mp;
      if (typeof item.properties?.bonus_ap === "number") ap += item.properties.bonus_ap;
    }
    return { hp, mp, ap };
  }

  tickEffects(): string[] {
    const expired: string[] = [];
    const remaining = [];

    for (const effect of this.state.activeEffects) {
      effect.remainingTicks--;
      if (effect.remainingTicks <= 0) {
        if (effect.attribute) {
          const current = this.state.attributes[effect.attribute] ?? 10;
          if (effect.type === "buff") {
            this.state.attributes[effect.attribute] = current - effect.magnitude;
          } else {
            this.state.attributes[effect.attribute] = current + effect.magnitude;
          }
        }
        expired.push(effect.name);
      } else {
        remaining.push(effect);
      }
    }

    this.state.activeEffects = remaining;

    if (expired.length > 0) {
      this.recalculateDerived();
      this.state.currentHp = Math.min(this.state.currentHp, this.state.maxHp);
      this.state.currentMp = Math.min(this.state.currentMp, this.state.maxMp);
    }

    return expired;
  }

  respawn(spawnRoom: string): void {
    this.state.currentRoom = spawnRoom;
    this.state.currentHp = Math.max(1, Math.floor(this.state.maxHp * 0.25));
    this.state.currentMp = Math.max(0, Math.floor(this.state.maxMp * 0.25));
    this.combatTarget = null;
    this.isDefending = false;
  }
}
