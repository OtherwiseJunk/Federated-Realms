import { describe, expect, test, afterEach } from "bun:test";
import { loadConfig } from "./server-config.js";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  test("returns defaults when no env vars set", () => {
    // Clear relevant env vars
    delete process.env.SERVER_NAME;
    delete process.env.PORT;
    delete process.env.TICK_RATE;
    delete process.env.BSKY_ENABLED;
    delete process.env.TRUST_POLICY;

    const config = loadConfig();
    expect(config.name).toBe("Federated Realms");
    expect(config.port).toBe(3000);
    expect(config.tickRate).toBe(250);
    expect(config.defaultSpawnRoom).toBe("starter-town:town-square");
    expect(config.bluesky.enabled).toBe(false);
    expect(config.federation.trustPolicy).toBe("trust-listed");
  });

  test("reads SERVER_NAME from env", () => {
    process.env.SERVER_NAME = "My Custom Realm";
    const config = loadConfig();
    expect(config.name).toBe("My Custom Realm");
  });

  test("parses PORT as integer", () => {
    process.env.PORT = "8080";
    const config = loadConfig();
    expect(config.port).toBe(8080);
  });

  test("parses bluesky post types", () => {
    process.env.BSKY_POST_TYPES = "chat,combat,system";
    const config = loadConfig();
    expect(config.bluesky.postTypes).toEqual(["chat", "combat", "system"]);
  });

  test("handles empty bluesky post types", () => {
    process.env.BSKY_POST_TYPES = "";
    const config = loadConfig();
    expect(config.bluesky.postTypes).toEqual([]);
  });

  test("parses trust policy with validation", () => {
    process.env.TRUST_POLICY = "trust-all";
    expect(loadConfig().federation.trustPolicy).toBe("trust-all");

    process.env.TRUST_POLICY = "trust-none";
    expect(loadConfig().federation.trustPolicy).toBe("trust-none");

    process.env.TRUST_POLICY = "trust-level-cap";
    expect(loadConfig().federation.trustPolicy).toBe("trust-level-cap");

    // Invalid falls back to trust-listed
    process.env.TRUST_POLICY = "invalid-policy";
    expect(loadConfig().federation.trustPolicy).toBe("trust-listed");
  });

  test("parses trusted servers list", () => {
    process.env.TRUSTED_SERVERS = "did:plc:server1,did:plc:server2, did:plc:server3 ";
    const config = loadConfig();
    expect(config.federation.trustedServers).toEqual([
      "did:plc:server1",
      "did:plc:server2",
      "did:plc:server3",
    ]);
  });

  test("empty trusted servers returns empty array", () => {
    process.env.TRUSTED_SERVERS = "";
    const config = loadConfig();
    expect(config.federation.trustedServers).toEqual([]);
  });

  test("parses AT Proto config", () => {
    process.env.PDS_URL = "https://pds.example.com";
    process.env.SERVER_DID = "did:plc:test123";
    process.env.PUBLIC_URL = "https://game.example.com";

    const config = loadConfig();
    expect(config.atproto.pdsUrl).toBe("https://pds.example.com");
    expect(config.atproto.serverDid).toBe("did:plc:test123");
    expect(config.atproto.publicUrl).toBe("https://game.example.com");
  });

  test("dataDir defaults to ./.state and reads DATA_DIR", () => {
    delete process.env.DATA_DIR;
    expect(loadConfig().dataDir).toBe("./.state");
    process.env.DATA_DIR = "/data";
    expect(loadConfig().dataDir).toBe("/data");
  });

  test("pdsPublicUrl derives from PDS_HOSTNAME when not localhost", () => {
    delete process.env.PDS_PUBLIC_URL;
    process.env.PDS_HOSTNAME = "fmpds.example.com";
    expect(loadConfig().atproto.pdsPublicUrl).toBe("https://fmpds.example.com");
  });

  test("pdsPublicUrl falls back to pdsUrl for localhost", () => {
    delete process.env.PDS_PUBLIC_URL;
    delete process.env.PDS_HOSTNAME;
    process.env.PDS_URL = "http://localhost:2583";
    expect(loadConfig().atproto.pdsPublicUrl).toBe("http://localhost:2583");
  });

  test("PDS_PUBLIC_URL env overrides derivation", () => {
    process.env.PDS_PUBLIC_URL = "https://pds.example.com";
    process.env.PDS_HOSTNAME = "other.example.com";
    expect(loadConfig().atproto.pdsPublicUrl).toBe("https://pds.example.com");
  });
});
