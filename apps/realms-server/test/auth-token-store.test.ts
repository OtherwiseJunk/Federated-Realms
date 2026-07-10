import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { AuthTokenStore } from "../src/atproto/auth-token-store.js";

describe("AuthTokenStore", () => {
  test("issue returns a 64-char hex token", () => {
    const store = new AuthTokenStore(new Database(":memory:"));
    const token = store.issue("did:plc:alice");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  test("verify returns the DID for a valid token", () => {
    const store = new AuthTokenStore(new Database(":memory:"));
    const token = store.issue("did:plc:alice");
    expect(store.verify(token)).toBe("did:plc:alice");
  });

  test("verify returns null for an unknown token", () => {
    const store = new AuthTokenStore(new Database(":memory:"));
    expect(store.verify("f".repeat(64))).toBeNull();
  });

  test("raw token is not stored in the database", () => {
    const db = new Database(":memory:");
    const store = new AuthTokenStore(db);
    const token = store.issue("did:plc:alice");
    const rows = db.query("SELECT token_hash FROM auth_tokens").all() as {
      token_hash: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(token);
  });

  test("verify returns null and deletes an expired token", () => {
    const db = new Database(":memory:");
    const store = new AuthTokenStore(db);
    const token = store.issue("did:plc:alice");
    db.run("UPDATE auth_tokens SET expires_at = ?", [Date.now() - 1000]);
    expect(store.verify(token)).toBeNull();
    expect(db.query("SELECT * FROM auth_tokens").all()).toHaveLength(0);
  });

  test("verify slides expiry forward", () => {
    const db = new Database(":memory:");
    const store = new AuthTokenStore(db);
    const token = store.issue("did:plc:alice");
    const soonish = Date.now() + 60_000; // expiring in a minute
    db.run("UPDATE auth_tokens SET expires_at = ?", [soonish]);
    expect(store.verify(token)).toBe("did:plc:alice");
    const row = db.query("SELECT expires_at FROM auth_tokens").get() as { expires_at: number };
    expect(row.expires_at).toBeGreaterThan(soonish);
  });

  test("revoke deletes the token", () => {
    const store = new AuthTokenStore(new Database(":memory:"));
    const token = store.issue("did:plc:alice");
    store.revoke(token);
    expect(store.verify(token)).toBeNull();
  });

  test("purgeExpired deletes expired rows, keeps valid ones, and returns the deleted count", () => {
    const db = new Database(":memory:");
    const store = new AuthTokenStore(db);
    const expiredToken = store.issue("did:plc:alice");
    const validToken = store.issue("did:plc:bob");
    db.run("UPDATE auth_tokens SET expires_at = ? WHERE did = ?", [
      Date.now() - 1000,
      "did:plc:alice",
    ]);

    const deleted = store.purgeExpired();

    expect(deleted).toBe(1);
    const rows = db.query("SELECT did FROM auth_tokens").all() as { did: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].did).toBe("did:plc:bob");
    expect(store.verify(validToken)).toBe("did:plc:bob");
    expect(store.verify(expiredToken)).toBeNull();
  });
});
