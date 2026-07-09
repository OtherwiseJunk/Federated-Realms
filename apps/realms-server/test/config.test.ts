import { describe, expect, test, afterEach } from "bun:test";
import { loadConfig } from "../src/config.js";

describe("loadConfig auth additions", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
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
