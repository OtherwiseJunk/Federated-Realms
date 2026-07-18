import { describe, expect, test } from "bun:test";
import { ServerIdentity, serverAccountLoginError } from "./server-identity.js";

describe("transfer token signing", () => {
  function payload() {
    const now = Math.floor(Date.now() / 1000);
    return {
      iss: "did:plc:source",
      sub: "did:plc:player",
      aud: "did:plc:target",
      iat: now,
      exp: now + 60,
      characterHash: "abc123",
      targetRoom: "starter-town:square",
    };
  }

  test("round-trips a signed transfer token", async () => {
    const server = new ServerIdentity();
    await server.initSigningKey();
    const token = await server.signTransferToken(payload());
    const verified = await server.verifyTransferToken(token, "did:plc:target");
    expect(verified).toMatchObject({
      iss: "did:plc:source",
      sub: "did:plc:player",
      aud: "did:plc:target",
      characterHash: "abc123",
      targetRoom: "starter-town:square",
    });
  });

  test("rejects a token for the wrong audience", async () => {
    const server = new ServerIdentity();
    await server.initSigningKey();
    const token = await server.signTransferToken(payload());
    expect(await server.verifyTransferToken(token, "did:plc:someone-else")).toBeNull();
  });

  test("rejects an expired token", async () => {
    const server = new ServerIdentity();
    await server.initSigningKey();
    const now = Math.floor(Date.now() / 1000);
    const token = await server.signTransferToken({ ...payload(), iat: now - 120, exp: now - 60 });
    expect(await server.verifyTransferToken(token, "did:plc:target")).toBeNull();
  });

  test("rejects a tampered token", async () => {
    const server = new ServerIdentity();
    await server.initSigningKey();
    const token = await server.signTransferToken(payload());
    const tampered = token.slice(0, -4) + (token.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
    expect(await server.verifyTransferToken(tampered, "did:plc:target")).toBeNull();
  });

  test("rejects a token whose payload omits expiry (fail closed)", async () => {
    const server = new ServerIdentity();
    await server.initSigningKey();
    // A signer that omits exp produces a token with no enforceable expiry.
    const token = await server.signTransferToken({
      ...payload(),
      exp: undefined as unknown as number,
    });
    expect(await server.verifyTransferToken(token, "did:plc:target")).toBeNull();
  });

  test("verifies a remote token against the signer's public key", async () => {
    const source = new ServerIdentity();
    await source.initSigningKey();
    const target = new ServerIdentity();
    await target.initSigningKey();
    const token = await source.signTransferToken(payload());
    const verified = await target.verifyRemoteTransferToken(
      token,
      "did:plc:target",
      source.getPublicKeyBytes(),
    );
    expect(verified).toMatchObject({ sub: "did:plc:player" });
  });

  test("rejects a remote token verified against the wrong public key", async () => {
    const source = new ServerIdentity();
    await source.initSigningKey();
    const target = new ServerIdentity();
    await target.initSigningKey();
    const token = await source.signTransferToken(payload());
    expect(
      await target.verifyRemoteTransferToken(token, "did:plc:target", target.getPublicKeyBytes()),
    ).toBeNull();
  });
});

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
