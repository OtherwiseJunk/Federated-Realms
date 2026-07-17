import { describe, expect, test } from "bun:test";
import { serverAccountLoginError } from "./server-identity.js";

describe("serverAccountLoginError", () => {
  const err = serverAccountLoginError(
    "gameserver.fmpds.example.com",
    "did:plc:abc123",
    "https://pds.example.com",
    "Unable to resolve handle",
  );

  test("names the handle, DID, PDS, and underlying cause", () => {
    expect(err.message).toContain("gameserver.fmpds.example.com");
    expect(err.message).toContain("did:plc:abc123");
    expect(err.message).toContain("https://pds.example.com");
    expect(err.message).toContain("Unable to resolve handle");
  });

  test("explains the wipe scenario and the actionable recovery", () => {
    const m = err.message.toLowerCase();
    expect(m).toContain("recreate");
    expect(err.message).toContain("SERVER_DID");
    // mentions that the DID can outlive its account (PLC vs PDS)
    expect(m).toMatch(/plc|wipe|reset/);
  });
});
