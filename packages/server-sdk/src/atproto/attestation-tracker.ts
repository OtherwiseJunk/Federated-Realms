import type { ServerIdentity, SignedAttestation, AttestationClaims } from "./server-identity.js";

export class AttestationTracker {
  readonly attestations: SignedAttestation[] = [];
  private pending: AttestationClaims = {};
  private signing: Promise<void> | null = null;

  constructor(
    private serverIdentity: ServerIdentity,
    private playerDid: string,
  ) {}

  private get canSign(): boolean {
    return !!this.serverIdentity.did;
  }

  recordLevelUp(level: number, xp: number): void {
    this.pending.level = level;
    this.pending.xp = xp;
    this.flush();
  }

  recordItemGrant(itemDefId: string): void {
    if (!this.pending.itemsGranted) this.pending.itemsGranted = [];
    this.pending.itemsGranted.push(itemDefId);
  }

  recordQuestComplete(questId: string): void {
    if (!this.pending.questsCompleted) this.pending.questsCompleted = [];
    this.pending.questsCompleted.push(questId);
    this.flush();
  }

  recordGoldChange(totalGold: number): void {
    this.pending.gold = totalGold;
  }

  flush(): void {
    if (!this.canSign) return;
    if (!this.hasPending()) return;

    const claims = { ...this.pending };
    this.pending = {};

    const prev = this.signing ?? Promise.resolve();
    this.signing = prev
      .then(async () => {
        const attestation = await this.serverIdentity.signAttestation(this.playerDid, claims);
        this.attestations.push(attestation);
      })
      .catch(() => {
        this.pending = { ...claims, ...this.pending };
      });
  }

  async finalize(): Promise<SignedAttestation[]> {
    this.flush();
    if (this.signing) {
      await this.signing;
    }
    return [...this.attestations];
  }

  private hasPending(): boolean {
    return !!(
      this.pending.level ||
      this.pending.xp ||
      this.pending.gold !== undefined ||
      this.pending.itemsGranted?.length ||
      this.pending.questsCompleted?.length
    );
  }
}
