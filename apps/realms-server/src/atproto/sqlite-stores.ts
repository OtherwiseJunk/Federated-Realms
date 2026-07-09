import type { Database } from "bun:sqlite";

/** Allowed table names — interpolated into SQL, so restrict to known values. */
export type OAuthStoreTable = "oauth_state" | "oauth_session";

/**
 * SQLite-backed key/value store implementing the SimpleStore interface that
 * @atproto/oauth-client-node expects for stateStore/sessionStore.
 * Values must be JSON-serializable (NodeSavedState / NodeSavedSession are).
 */
export class SqliteSimpleStore<V> {
  constructor(
    private db: Database,
    private table: OAuthStoreTable,
  ) {
    this.db.run(
      `CREATE TABLE IF NOT EXISTS ${this.table} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    );
  }

  async get(key: string): Promise<V | undefined> {
    const row = this.db.query(`SELECT value FROM ${this.table} WHERE key = ?`).get(key) as {
      value: string;
    } | null;
    return row ? (JSON.parse(row.value) as V) : undefined;
  }

  async set(key: string, value: V): Promise<void> {
    this.db.run(
      `INSERT INTO ${this.table} (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, JSON.stringify(value)],
    );
  }

  async del(key: string): Promise<void> {
    this.db.run(`DELETE FROM ${this.table} WHERE key = ?`, [key]);
  }
}
