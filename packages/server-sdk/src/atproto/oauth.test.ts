import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { GameOAuthClient } from "./oauth.js";
import { SqliteSimpleStore } from "./sqlite-stores.js";

const config = {
  pdsUrl: "http://localhost:2583",
  pdsHostname: "localhost",
  serverDid: "",
  serverHandle: "server.localhost",
  serverPassword: "",
  serverSigningKey: "",
  signingKeyPath: "",
  publicUrl: "https://realms.example.com",
  pdsPublicUrl: "http://localhost:2583",
};

describe("GameOAuthClient", () => {
  test("initializes with injected sqlite stores", async () => {
    const db = new Database(":memory:");
    const client = new GameOAuthClient();
    await client.initialize(config, {
      stateStore: new SqliteSimpleStore(db, "oauth_state"),
      sessionStore: new SqliteSimpleStore(db, "oauth_session"),
    });
    expect(client.initialized).toBe(true);
  });

  test("initializes without stores (memory fallback)", async () => {
    const client = new GameOAuthClient();
    await client.initialize(config);
    expect(client.initialized).toBe(true);
  });
});
