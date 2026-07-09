import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SqliteSimpleStore } from "../src/atproto/sqlite-stores.js";

describe("SqliteSimpleStore", () => {
  test("get returns undefined for missing key", async () => {
    const store = new SqliteSimpleStore<{ a: number }>(new Database(":memory:"), "oauth_state");
    expect(await store.get("nope")).toBeUndefined();
  });

  test("set then get round-trips JSON values", async () => {
    const store = new SqliteSimpleStore<{ a: number; b: string }>(
      new Database(":memory:"),
      "oauth_state",
    );
    await store.set("k1", { a: 1, b: "two" });
    expect(await store.get("k1")).toEqual({ a: 1, b: "two" });
  });

  test("set overwrites existing key", async () => {
    const store = new SqliteSimpleStore<number>(new Database(":memory:"), "oauth_session");
    await store.set("k", 1);
    await store.set("k", 2);
    expect(await store.get("k")).toBe(2);
  });

  test("del removes key", async () => {
    const store = new SqliteSimpleStore<number>(new Database(":memory:"), "oauth_session");
    await store.set("k", 1);
    await store.del("k");
    expect(await store.get("k")).toBeUndefined();
  });

  test("two stores on one db are isolated by table", async () => {
    const db = new Database(":memory:");
    const a = new SqliteSimpleStore<string>(db, "oauth_state");
    const b = new SqliteSimpleStore<string>(db, "oauth_session");
    await a.set("k", "state");
    await b.set("k", "session");
    expect(await a.get("k")).toBe("state");
    expect(await b.get("k")).toBe("session");
  });
});
