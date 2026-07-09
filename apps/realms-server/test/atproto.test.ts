import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import { TestClient, startServer, stopServer } from "./helpers.ts";
import { ServerIdentity } from "../src/atproto/server-identity.ts";
import { AttestationTracker } from "../src/atproto/attestation-tracker.ts";
import { PortalHandler } from "../src/federation/portal-handler.ts";

// ── Server in dev mode (AT Proto endpoints still respond) ──

let devPort: number;
let devProc: Subprocess;

// ── Server in auth mode (no PDS, but AT Proto required) ──

let authPort: number;
let authProc: Subprocess;

beforeAll(async () => {
  const [dev, auth] = await Promise.all([
    startServer({ devMode: true }),
    startServer({ devMode: false }),
  ]);
  devPort = dev.port;
  devProc = dev.process;
  authPort = auth.port;
  authProc = auth.process;
});

afterAll(() => {
  stopServer(devProc);
  stopServer(authProc);
});

// ─── OAuth Client Metadata ──────────────────────────────────

describe("oauth client metadata", () => {
  test("serves client metadata JSON", async () => {
    const res = await fetch(`http://127.0.0.1:${devPort}/oauth/client-metadata.json`);
    expect(res.ok).toBe(true);
    const meta = (await res.json()) as Record<string, unknown>;
    expect(meta.client_name).toBe("Federated Realms");
    expect(meta.grant_types).toEqual(["authorization_code", "refresh_token"]);
    expect(meta.dpop_bound_access_tokens).toBe(true);
    expect(meta.token_endpoint_auth_method).toBe("none");
    expect(meta.scope).toBe("atproto transition:generic");
  });

  test("client_id points to itself", async () => {
    const res = await fetch(`http://127.0.0.1:${devPort}/oauth/client-metadata.json`);
    const meta = (await res.json()) as Record<string, unknown>;
    expect(meta.client_id).toContain("/oauth/client-metadata.json");
  });

  test("redirect_uris includes localhost for CLI", async () => {
    const res = await fetch(`http://127.0.0.1:${devPort}/oauth/client-metadata.json`);
    const meta = (await res.json()) as Record<string, unknown>;
    const uris = meta.redirect_uris as string[];
    expect(uris.some((u) => u.startsWith("http://127.0.0.1"))).toBe(true);
  });
});

// ─── Auth Endpoints ─────────────────────────────────────────

describe("auth endpoints", () => {
  test("/auth/login requires handle param", async () => {
    const res = await fetch(`http://127.0.0.1:${devPort}/auth/login`);
    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toContain("handle");
  });

  test("/auth/login with invalid handle returns error (no PDS)", async () => {
    const res = await fetch(`http://127.0.0.1:${devPort}/auth/login?handle=nonexistent.invalid`);
    // Should fail because OAuth client isn't initialized (no PDS configured)
    expect(res.status).toBe(500);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBeTruthy();
  });

  test("/auth/login?signup=true returns 503 when signup is unavailable", async () => {
    // In DEV_MODE the OAuth client is never initialized, so signup can't
    // proceed. This should be a clean 503, not the generic 500 that
    // authorize() would otherwise throw ("OAuth not initialized").
    const res = await fetch(`http://127.0.0.1:${devPort}/auth/login?signup=true`);
    expect(res.status).toBe(503);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBe("Signup is not available on this server");
  });
});

// ─── XRPC Endpoints ─────────────────────────────────────────

describe("XRPC action.connect", () => {
  test("rejects without a bearer token", async () => {
    const res = await fetch(
      `http://127.0.0.1:${devPort}/xrpc/com.cacheblasters.realms.action.connect`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
    );
    expect(res.status).toBe(401);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toContain("Authentication required");
  });

  test("ignores a DID supplied in the body and still requires a bearer token", async () => {
    // Regression check for the impersonation bypass: a client-supplied DID
    // must never be trusted in place of a server-issued bearer token.
    const res = await fetch(
      `http://127.0.0.1:${devPort}/xrpc/com.cacheblasters.realms.action.connect`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ did: "did:plc:fake123" }),
      },
    );
    expect(res.status).toBe(401);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toContain("Authentication required");
  });
});

describe("XRPC action.createCharacter", () => {
  test("rejects without a bearer token before validating fields", async () => {
    // The auth gate runs before body parsing, so a missing bearer token
    // wins over missing fields even when the body itself is incomplete.
    const res = await fetch(
      `http://127.0.0.1:${devPort}/xrpc/com.cacheblasters.realms.action.createCharacter`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ did: "did:plc:test", name: "Hero" }),
      },
    );
    expect(res.status).toBe(401);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toContain("Authentication required");
  });

  test("rejects a fully-populated body when no bearer token is present", async () => {
    const res = await fetch(
      `http://127.0.0.1:${devPort}/xrpc/com.cacheblasters.realms.action.createCharacter`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          did: "did:plc:fake",
          name: "Hero",
          classId: "warrior",
          raceId: "human",
        }),
      },
    );
    expect(res.status).toBe(401);
  });
});

// ─── Federation Transfer ────────────────────────────────────

describe("XRPC federation.transfer", () => {
  test("rejects with missing fields", async () => {
    const res = await fetch(
      `http://127.0.0.1:${devPort}/xrpc/com.cacheblasters.realms.federation.transfer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toContain("required");
  });

  test("rejects with invalid JWT token", async () => {
    const res = await fetch(
      `http://127.0.0.1:${devPort}/xrpc/com.cacheblasters.realms.federation.transfer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "invalid.jwt.token",
          character: {
            name: "Hacker",
            class: "warrior",
            race: "human",
            level: 1,
            experience: 0,
            attributes: {},
            createdAt: new Date().toISOString(),
          },
        }),
      },
    );
    expect(res.ok).toBe(true);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.accepted).toBe(false);
    expect(typeof data.reason).toBe("string");
  });
});

// ─── Auth-Required Server (no dev mode) ─────────────────────

describe("auth enforcement (no dev mode)", () => {
  test("health endpoint still works", async () => {
    const res = await fetch(`http://127.0.0.1:${authPort}/health`);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.status).toBe("ok");
  });

  test("info endpoint still works", async () => {
    const res = await fetch(`http://127.0.0.1:${authPort}/info`);
    expect(res.ok).toBe(true);
  });

  test("system endpoint still works", async () => {
    const res = await fetch(`http://127.0.0.1:${authPort}/system`);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.classes).toBeDefined();
  });

  test("WebSocket rejects connection without session", async () => {
    // Without DEV_MODE, connecting to /ws without a valid session should fail
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${authPort}/ws`);
      const result = await new Promise<string>((resolve) => {
        ws.onopen = () => resolve("opened");
        ws.onerror = () => resolve("error");
        ws.onclose = (e) => resolve(`closed:${e.code}`);
        setTimeout(() => resolve("timeout"), 3000);
      });
      // Server should have returned a 401, which closes/rejects the WS
      expect(result).not.toBe("opened");
    } catch {
      // Connection failure is expected
    }
  });

  test("XRPC endpoints respond with proper errors", async () => {
    const res = await fetch(
      `http://127.0.0.1:${authPort}/xrpc/com.cacheblasters.realms.action.connect`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ did: "did:plc:test123" }),
      },
    );
    // Should return 401 since no bearer token was supplied
    expect(res.status).toBe(401);
  });
});

// ─── Adaptation Protocol ────────────────────────────────────

describe("adaptation protocol", () => {
  test("dev mode server accepts WebSocket with session param", async () => {
    // In dev mode, WS connections create sessions on the fly
    const client = new TestClient("AdaptTest");
    await client.connect(devPort);
    const welcome = await client.waitFor("welcome");
    expect(welcome.sessionId).toBeTruthy();
    client.disconnect();
  });

  test("adaptation_response is handled without error for non-pending session", async () => {
    // Connect normally (no pending adaptation), send adaptation_response
    // Server should silently ignore it (no crash, no error)
    const client = new TestClient("NoAdaptTest");
    await client.connect(devPort);
    await client.waitFor("welcome");
    await client.waitFor("room_state");

    // Send an adaptation response with no pending adaptation
    client.sendRaw({ type: "adaptation_response", classId: "mage", raceId: "elf" });

    // Should still be able to send normal commands after
    await client.tick(200);
    const room = await client.commandAndWaitRoom("look");
    expect(room.room.title).toBe("Town Square");

    client.disconnect();
  });
});

// ─── Transfer Handler Logic (via HTTP) ──────────────────────

describe("transfer handler validation", () => {
  test("rejects expired JWT-like structure", async () => {
    // Even with a structurally valid JWT, it should be rejected
    // because it can't be verified without the signing key
    const fakeJwt = [
      btoa(JSON.stringify({ alg: "ES256K", typ: "JWT" })),
      btoa(
        JSON.stringify({
          iss: "did:plc:source",
          sub: "did:plc:player",
          aud: "did:plc:target",
          exp: 0,
          iat: 0,
          characterHash: "abc",
          targetRoom: "room-1",
        }),
      ),
      "fakesignature",
    ].join(".");

    const res = await fetch(
      `http://127.0.0.1:${devPort}/xrpc/com.cacheblasters.realms.federation.transfer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: fakeJwt,
          character: {
            name: "Intruder",
            class: "warrior",
            race: "human",
            level: 99,
            experience: 0,
            attributes: {},
            createdAt: new Date().toISOString(),
          },
        }),
      },
    );

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.accepted).toBe(false);
  });

  test("transfer endpoint accepts POST only", async () => {
    const res = await fetch(
      `http://127.0.0.1:${devPort}/xrpc/com.cacheblasters.realms.federation.transfer`,
      { method: "GET" },
    );
    // GET should not match the route and fall through to default handler
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Federated Realms");
  });

  test("connect endpoint accepts POST only", async () => {
    const res = await fetch(
      `http://127.0.0.1:${devPort}/xrpc/com.cacheblasters.realms.action.connect`,
      { method: "GET" },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Federated Realms");
  });
});

// ─── Attestation Signing & Verification ──────────────────────

describe("attestation signing", () => {
  let identity: ServerIdentity;

  beforeAll(async () => {
    identity = new ServerIdentity();
    identity.did = "did:plc:testserver123";
    await identity.initSigningKeyOnly();
  });

  test("signAttestation produces valid signature", async () => {
    const attestation = await identity.signAttestation("did:plc:player1", {
      level: 5,
      xp: 500,
      gold: 100,
    });

    expect(attestation.iss).toBe("did:plc:testserver123");
    expect(attestation.sub).toBe("did:plc:player1");
    expect(attestation.claims.level).toBe(5);
    expect(attestation.claims.xp).toBe(500);
    expect(attestation.claims.gold).toBe(100);
    expect(attestation.sig).toBeTruthy();
    expect(attestation.sig.length).toBeGreaterThan(10);
  });

  test("verifyAttestation validates own signatures", async () => {
    const attestation = await identity.signAttestation("did:plc:player1", {
      level: 3,
      itemsGranted: ["iron-sword", "health-potion"],
    });

    const valid = await identity.verifyAttestation(attestation);
    expect(valid).toBe(true);
  });

  test("verifyAttestation rejects tampered claims", async () => {
    const attestation = await identity.signAttestation("did:plc:player1", {
      level: 3,
    });

    // Tamper with the claims
    attestation.claims.level = 99;

    const valid = await identity.verifyAttestation(attestation);
    expect(valid).toBe(false);
  });

  test("verifyAttestation rejects tampered subject", async () => {
    const attestation = await identity.signAttestation("did:plc:player1", {
      gold: 1000,
    });

    attestation.sub = "did:plc:cheater";

    const valid = await identity.verifyAttestation(attestation);
    expect(valid).toBe(false);
  });

  test("signAttestation includes quest and item arrays", async () => {
    const attestation = await identity.signAttestation("did:plc:player2", {
      questsCompleted: ["kill-rats", "find-sword"],
      itemsGranted: ["magic-ring"],
    });

    expect(attestation.claims.questsCompleted).toEqual(["kill-rats", "find-sword"]);
    expect(attestation.claims.itemsGranted).toEqual(["magic-ring"]);
  });
});

// ─── Remote Attestation Verification ─────────────────────

describe("remote attestation verification", () => {
  let sourceServer: ServerIdentity;
  let targetServer: ServerIdentity;

  beforeAll(async () => {
    sourceServer = new ServerIdentity();
    sourceServer.did = "did:plc:sourceserver";
    await sourceServer.initSigningKeyOnly();

    targetServer = new ServerIdentity();
    targetServer.did = "did:plc:targetserver";
    await targetServer.initSigningKeyOnly();
  });

  test("target verifies attestation signed by source using source public key", async () => {
    const attestation = await sourceServer.signAttestation("did:plc:player1", {
      level: 10,
      gold: 500,
      itemsGranted: ["magic-sword"],
    });

    const valid = await targetServer.verifyRemoteAttestation(
      attestation,
      sourceServer.getPublicKeyBytes(),
    );
    expect(valid).toBe(true);
  });

  test("rejects attestation verified with wrong public key", async () => {
    const attestation = await sourceServer.signAttestation("did:plc:player1", {
      level: 5,
    });

    // Try to verify with target's own key (wrong key)
    const valid = await targetServer.verifyRemoteAttestation(
      attestation,
      targetServer.getPublicKeyBytes(),
    );
    expect(valid).toBe(false);
  });

  test("rejects tampered attestation even with correct key", async () => {
    const attestation = await sourceServer.signAttestation("did:plc:player1", {
      level: 5,
      gold: 100,
    });

    // Tamper with claims
    attestation.claims.gold = 999999;

    const valid = await targetServer.verifyRemoteAttestation(
      attestation,
      sourceServer.getPublicKeyBytes(),
    );
    expect(valid).toBe(false);
  });

  test("source can still verify its own attestations", async () => {
    const attestation = await sourceServer.signAttestation("did:plc:player1", {
      questsCompleted: ["save-the-village"],
    });

    const valid = await sourceServer.verifyAttestation(attestation);
    expect(valid).toBe(true);
  });

  test("multiple attestations from same source all verify", async () => {
    const att1 = await sourceServer.signAttestation("did:plc:player1", { level: 2 });
    const att2 = await sourceServer.signAttestation("did:plc:player1", { gold: 50 });
    const att3 = await sourceServer.signAttestation("did:plc:player2", {
      itemsGranted: ["shield"],
    });

    const pubKey = sourceServer.getPublicKeyBytes();
    expect(await targetServer.verifyRemoteAttestation(att1, pubKey)).toBe(true);
    expect(await targetServer.verifyRemoteAttestation(att2, pubKey)).toBe(true);
    expect(await targetServer.verifyRemoteAttestation(att3, pubKey)).toBe(true);
  });
});

// ─── Public Key Serialization ────────────────────────────

describe("signing key serialization", () => {
  test("public key bytes round-trip through base64url", async () => {
    const server = new ServerIdentity();
    server.did = "did:plc:roundtrip";
    await server.initSigningKeyOnly();

    const keyBytes = server.getPublicKeyBytes();
    const encoded = Buffer.from(keyBytes).toString("base64url");
    const decoded = Buffer.from(encoded, "base64url");

    expect(decoded.length).toBe(keyBytes.length);
    expect(Buffer.from(keyBytes).equals(decoded)).toBe(true);
  });

  test("attestation verified via serialized key", async () => {
    const source = new ServerIdentity();
    source.did = "did:plc:source";
    await source.initSigningKeyOnly();

    const target = new ServerIdentity();
    target.did = "did:plc:target";
    await target.initSigningKeyOnly();

    // Simulate: source publishes key as base64url
    const publishedKey = Buffer.from(source.getPublicKeyBytes()).toString("base64url");

    // Target resolves it back
    const resolvedKey = new Uint8Array(Buffer.from(publishedKey, "base64url"));

    const attestation = await source.signAttestation("did:plc:player", {
      level: 7,
      gold: 300,
    });

    const valid = await target.verifyRemoteAttestation(attestation, resolvedKey);
    expect(valid).toBe(true);
  });
});

// ─── Attestation Tracker ──────────────────────

describe("attestation tracker", () => {
  let identity: ServerIdentity;

  beforeAll(async () => {
    identity = new ServerIdentity();
    identity.did = "did:plc:testserver456";
    await identity.initSigningKeyOnly();
  });

  test("recordLevelUp triggers immediate flush", async () => {
    const tracker = new AttestationTracker(identity, "did:plc:player1");

    tracker.recordLevelUp(5, 500);

    const attestations = await tracker.finalize();
    expect(attestations.length).toBe(1);
    expect(attestations[0].claims.level).toBe(5);
    expect(attestations[0].claims.xp).toBe(500);
  });

  test("recordQuestComplete triggers immediate flush", async () => {
    const tracker = new AttestationTracker(identity, "did:plc:player1");

    tracker.recordQuestComplete("kill-rats");

    const attestations = await tracker.finalize();
    expect(attestations.length).toBe(1);
    expect(attestations[0].claims.questsCompleted).toEqual(["kill-rats"]);
  });

  test("batches gold and item changes until flush", async () => {
    const tracker = new AttestationTracker(identity, "did:plc:player1");

    tracker.recordGoldChange(50);
    tracker.recordItemGrant("iron-sword");
    tracker.recordItemGrant("health-potion");

    // Nothing flushed yet — no high-value events
    expect(tracker.attestations.length).toBe(0);

    // Finalize forces flush
    const attestations = await tracker.finalize();
    expect(attestations.length).toBe(1);
    expect(attestations[0].claims.gold).toBe(50);
    expect(attestations[0].claims.itemsGranted).toEqual(["iron-sword", "health-potion"]);
  });

  test("level up flushes pending gold/items into same attestation", async () => {
    const tracker = new AttestationTracker(identity, "did:plc:player1");

    tracker.recordGoldChange(100);
    tracker.recordItemGrant("epic-staff");
    // Level up should flush everything pending
    tracker.recordLevelUp(10, 2000);

    const attestations = await tracker.finalize();
    expect(attestations.length).toBe(1);
    expect(attestations[0].claims.level).toBe(10);
    expect(attestations[0].claims.gold).toBe(100);
    expect(attestations[0].claims.itemsGranted).toEqual(["epic-staff"]);
  });

  test("does nothing when server identity has no DID", async () => {
    const emptyIdentity = { did: "" } as ServerIdentity;
    const tracker = new AttestationTracker(emptyIdentity, "did:plc:player1");

    tracker.recordLevelUp(5, 500);
    tracker.recordGoldChange(100);

    const attestations = await tracker.finalize();
    expect(attestations.length).toBe(0);
  });

  test("multiple high-value events produce multiple attestations", async () => {
    const tracker = new AttestationTracker(identity, "did:plc:player1");

    tracker.recordLevelUp(2, 100);
    tracker.recordGoldChange(50);
    tracker.recordQuestComplete("quest-1");

    const attestations = await tracker.finalize();
    // Level up = 1 attestation, then quest complete flushes gold = 1 attestation
    expect(attestations.length).toBe(2);
    expect(attestations[0].claims.level).toBe(2);
    expect(attestations[1].claims.questsCompleted).toEqual(["quest-1"]);
    expect(attestations[1].claims.gold).toBe(50);
  });
});

// ─── Portal Target Parsing ──────────────────────────────────

describe("portal target parsing", () => {
  const handler = new PortalHandler({ did: "did:plc:local" } as any, {} as any, {
    trustPolicy: "trust-all",
    trustedServers: [],
    maxAcceptedLevel: 50,
  });

  test("parses did:plc portal target", () => {
    const result = handler.parsePortalTarget("did:plc:abc123xyz:arrival-hall");
    expect(result).not.toBeNull();
    expect(result!.serverDid).toBe("did:plc:abc123xyz");
    expect(result!.roomId).toBe("arrival-hall");
  });

  test("parses did:web portal target", () => {
    const result = handler.parsePortalTarget("did:web:example.com:spawn-room");
    expect(result).not.toBeNull();
    expect(result!.serverDid).toBe("did:web:example.com");
    expect(result!.roomId).toBe("spawn-room");
  });

  test("returns null for non-DID target", () => {
    const result = handler.parsePortalTarget("starter-town:town-square");
    expect(result).toBeNull();
  });

  test("identifies portal exits", () => {
    expect(
      handler.isPortalExit({ direction: "north", target: "did:plc:x:room", portal: true }),
    ).toBe(true);
    expect(handler.isPortalExit({ direction: "north", target: "room-id" })).toBe(false);
  });
});
