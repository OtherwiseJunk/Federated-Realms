import { afterEach, describe, expect, test } from "bun:test";
import { PortalHandler } from "./portal-handler.js";
import type { FederationManager, KnownServer } from "./federation-manager.js";
import type { ServerIdentity } from "../atproto/server-identity.js";
import type { CharacterSession } from "../entities/character-session.js";
import type { RoomExit } from "@realms/lexicons";
import { NSID } from "@realms/lexicons";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    return handler(url, init);
  }) as unknown as typeof fetch;
  return urls;
}

function fakeIdentity(): ServerIdentity {
  return {
    did: "did:plc:localserver",
    signTransferToken: async () => "signed.jwt.token",
  } as unknown as ServerIdentity;
}

function fakeSession(): CharacterSession {
  return {
    characterDid: "did:plc:player1",
    sessionId: "sess-1",
    state: {
      name: "Hero",
      class: "warrior",
      race: "human",
      level: 5,
      experience: 100,
      attributes: {},
      maxHp: 10,
      maxMp: 5,
      maxAp: 3,
      gold: 0,
      inventory: [],
      equipment: {},
      extensions: {},
    },
    send: () => {},
  } as unknown as CharacterSession;
}

function fakeFederation(server: Partial<KnownServer> | null): FederationManager {
  return {
    resolveServer: async () =>
      server === null
        ? null
        : {
            did: "did:plc:target",
            name: "Target Realm",
            endpoint: "wss://target.example/ws",
            lastSeen: Date.now(),
            ...server,
          },
  } as unknown as FederationManager;
}

const portalExit: RoomExit = {
  direction: "north",
  target: "did:plc:target:arrival-hall",
  portal: true,
};

const acceptedResponse = () =>
  Response.json({
    accepted: true,
    sessionId: "remote-sess",
    websocketUrl: "wss://target.example/ws?session=remote-sess",
    spawnRoom: "arrival-hall",
    serverName: "Target Realm",
  });

describe("PortalHandler.traverse URL construction", () => {
  test("posts the transfer to a single-prefixed XRPC URL", async () => {
    const handler = new PortalHandler(
      fakeIdentity(),
      fakeFederation({ xrpcEndpoint: "https://target.example/xrpc" }),
    );
    const urls = stubFetch(() => acceptedResponse());

    const ok = await handler.traverse(fakeSession(), portalExit, () => {});
    expect(ok).toBe(true);
    expect(urls).toEqual([`https://target.example/xrpc/${NSID.FederationTransfer}`]);
  });

  test("normalizes an endpoint published without the /xrpc prefix", async () => {
    const handler = new PortalHandler(
      fakeIdentity(),
      fakeFederation({ xrpcEndpoint: "https://target.example/" }),
    );
    const urls = stubFetch(() => acceptedResponse());

    const ok = await handler.traverse(fakeSession(), portalExit, () => {});
    expect(ok).toBe(true);
    expect(urls).toEqual([`https://target.example/xrpc/${NSID.FederationTransfer}`]);
  });
});

describe("PortalHandler.traverse failure paths", () => {
  test("fails with a friendly message when the target has no game xrpcEndpoint", async () => {
    // Server resolves (PDS exists) but publishes no game endpoint — must NOT
    // fall back to calling the PDS.
    const handler = new PortalHandler(fakeIdentity(), fakeFederation({ xrpcEndpoint: undefined }));
    const urls = stubFetch(() => acceptedResponse());
    const narratives: string[] = [];

    const ok = await handler.traverse(fakeSession(), portalExit, (text) => {
      narratives.push(text);
    });
    expect(ok).toBe(false);
    expect(urls).toEqual([]);
    expect(narratives.some((n) => n.includes("unreachable"))).toBe(true);
  });

  test("fails when the target server cannot be resolved", async () => {
    const handler = new PortalHandler(fakeIdentity(), fakeFederation(null));
    const urls = stubFetch(() => acceptedResponse());
    const narratives: string[] = [];

    const ok = await handler.traverse(fakeSession(), portalExit, (text) => {
      narratives.push(text);
    });
    expect(ok).toBe(false);
    expect(urls).toEqual([]);
    expect(narratives.some((n) => n.includes("unreachable"))).toBe(true);
  });

  test("fails when no federation manager is configured", async () => {
    const handler = new PortalHandler(fakeIdentity());
    const urls = stubFetch(() => acceptedResponse());
    const narratives: string[] = [];

    const ok = await handler.traverse(fakeSession(), portalExit, (text) => {
      narratives.push(text);
    });
    expect(ok).toBe(false);
    expect(urls).toEqual([]);
    expect(narratives.some((n) => n.includes("unreachable"))).toBe(true);
  });

  test("relays a rejection reason from the target server", async () => {
    const handler = new PortalHandler(
      fakeIdentity(),
      fakeFederation({ xrpcEndpoint: "https://target.example/xrpc" }),
    );
    stubFetch(() => Response.json({ accepted: false, reason: "Level too high" }));
    const narratives: string[] = [];

    const ok = await handler.traverse(fakeSession(), portalExit, (text) => {
      narratives.push(text);
    });
    expect(ok).toBe(false);
    expect(narratives.some((n) => n.includes("Level too high"))).toBe(true);
  });
});
