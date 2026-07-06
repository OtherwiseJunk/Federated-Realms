import type { ServerIdentity, SignedAttestation, AttestationClaims } from "./server-identity.js";

/**
 * Accumulates attestable events during a player's session and produces
 * signed attestations.
 *
 * Rather than signing every single gold change or item pickup individually,
 * we batch events and sign a summary attestation covering the session's
 * changes. High-value events (level up, quest completion) trigger an
 * immediate flush.
 */
export class AttestationTracker {
  /** Signed attestations produced during this session */
  readonly attestations: SignedAttestation[] = [];

  /** Pending (unsigned) claims accumulated since last flush */
  private pending: AttestationClaims = {};

  /** In-flight signing promise (prevents concurrent flushes) */
  private signing: Promise<void> | null = null;

  constructor(
    private serverIdentity: ServerIdentity,
    private playerDid: string,
  ) {}

  /** Whether the server identity is configured (has a DID / signing key) */
  private get canSign(): boolean {
    return !!this.serverIdentity.did;
  }

  // ── Event recording ──

  recordLevelUp(level: number, xp: number): void {
    this.pending.level = level;
    this.pending.xp = xp;
    // Level ups are high-value — sign immediately
    this.flush();
  }

  recordItemGrant(itemDefId: string): void {
    if (!this.pending.itemsGranted) this.pending.itemsGranted = [];
    this.pending.itemsGranted.push(itemDefId);
  }

  recordQuestComplete(questId: string): void {
    if (!this.pending.questsCompleted) this.pending.questsCompleted = [];
    this.pending.questsCompleted.push(questId);
    // Quest completion is high-value — sign immediately
    this.flush();
  }

  recordGoldChange(totalGold: number): void {
    this.pending.gold = totalGold;
  }

  // ── Signing ──

  /**
   * Sign any pending claims and add to attestation list.
   * Fire-and-forget — callers don't need to await.
   */
  flush(): void {
    if (!this.canSign) return;
    if (!this.hasPending()) return;

    const claims = { ...this.pending };
    this.pending = {};

    // Chain onto any in-flight signing to avoid races
    const prev = this.signing ?? Promise.resolve();
    this.signing = prev
      .then(async () => {
        const attestation = await this.serverIdentity.signAttestation(this.playerDid, claims);
        this.attestations.push(attestation);
      })
      .catch(() => {
        // Signing failed — re-merge claims so they aren't lost
        this.pending = { ...claims, ...this.pending };
      });
  }

  /**
   * Flush pending and wait for all signing to complete.
   * Returns all attestations for this session.
   * Called on disconnect or portal transfer.
   */
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
