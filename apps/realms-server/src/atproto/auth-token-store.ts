import type { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, sliding

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Server-issued bearer tokens binding a client to a DID. Minted at the end
 * of the OAuth callback; required on connect/createCharacter. Only the
 * sha256 of the token is stored.
 */
export class AuthTokenStore {
  constructor(private db: Database) {
    this.db.run(`CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash TEXT PRIMARY KEY,
      did TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL
    )`);
  }

  issue(did: string): string {
    const token = randomBytes(32).toString("hex");
    const now = Date.now();
    this.db.run(
      `INSERT INTO auth_tokens (token_hash, did, created_at, expires_at, last_used_at)
       VALUES (?, ?, ?, ?, ?)`,
      [hashToken(token), did, now, now + TOKEN_TTL_MS, now],
    );
    return token;
  }

  verify(token: string): string | null {
    const hash = hashToken(token);
    const now = Date.now();
    const row = this.db
      .query(`SELECT did, expires_at FROM auth_tokens WHERE token_hash = ?`)
      .get(hash) as { did: string; expires_at: number } | null;
    if (!row) return null;
    if (row.expires_at < now) {
      this.db.run(`DELETE FROM auth_tokens WHERE token_hash = ?`, [hash]);
      return null;
    }
    this.db.run(`UPDATE auth_tokens SET last_used_at = ?, expires_at = ? WHERE token_hash = ?`, [
      now,
      now + TOKEN_TTL_MS,
      hash,
    ]);
    return row.did;
  }

  revoke(token: string): void {
    this.db.run(`DELETE FROM auth_tokens WHERE token_hash = ?`, [hashToken(token)]);
  }
}
