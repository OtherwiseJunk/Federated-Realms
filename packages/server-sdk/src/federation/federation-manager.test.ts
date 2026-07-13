import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { FederationManager } from "./federation-manager.js";
import type { ServerIdentity } from "../atproto/server-identity.js";
import type { FederationConfig, AtProtoConfig } from "../types/server-config.js";
import { NSID } from "@realms/lexicons";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  setSystemTime();
});

/** FederationManager backed by an agent that captures every putRecord record. */
function captureManager(): {
  manager: FederationManager;
  records: Record<string, unknown>[];
} {
  const records: Record<string, unknown>[] = [];
  const identity = {
    did: "did:plc:self",
    getPublicKeyBytes: () => new Uint8Array([1, 2, 3]),
    agent: {
      com: {
        atproto: {
          repo: {
            putRecord: async (params: { record: Record<string, unknown> }) => {
              records.push(params.record);
            },
          },
        },
      },
    },
  } as unknown as ServerIdentity;
  const manager = new FederationManager(
    identity,
    federationConfig,
    { publicUrl: "https://local.example" } as AtProtoConfig,
    "Local Realm",
    "A test realm",
  );
  return { manager, records };
}

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

const federationConfig: FederationConfig = {
  trustPolicy: "trust-all",
  trustedServers: [],
  maxAcceptedLevel: 50,
};

const atprotoConfig = {
  publicUrl: "https://local.example",
} as AtProtoConfig;

function makeManager(identity?: Partial<ServerIdentity>): FederationManager {
  return new FederationManager(
    (identity ?? { did: "did:plc:self" }) as ServerIdentity,
    federationConfig,
    atprotoConfig,
    "Local Realm",
    "A test realm",
  );
}

const didDocResponse = () =>
  Response.json({
    service: [
      {
        id: "#atproto_pds",
        type: "AtprotoPersonalDataServer",
        serviceEndpoint: "https://pds.example",
      },
    ],
  });

describe("FederationManager.resolveServer", () => {
  test("resolves via registration record and normalizes xrpcEndpoint at the read boundary", async () => {
    stubFetch((url) => {
      if (url.startsWith("https://plc.directory/")) return didDocResponse();
      if (url.includes(NSID.FederationRegistration)) {
        return Response.json({
          value: {
            name: "Remote Realm",
            endpoint: "wss://remote.example/ws",
            // Published WITHOUT the /xrpc prefix — must be normalized on read
            xrpcEndpoint: "https://remote.example/",
            signingKey: "a2V5",
          },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const manager = makeManager();
    const server = await manager.resolveServer("did:plc:remote");
    expect(server).not.toBeNull();
    expect(server!.name).toBe("Remote Realm");
    expect(server!.xrpcEndpoint).toBe("https://remote.example/xrpc");
    expect(server!.signingKey).toBe("a2V5");
  });

  test("falls back to the world.server record when registration is missing", async () => {
    stubFetch((url) => {
      if (url.startsWith("https://plc.directory/")) return didDocResponse();
      if (url.includes(NSID.FederationRegistration)) {
        return new Response("not found", { status: 404 });
      }
      if (url.includes(NSID.WorldServer)) {
        return Response.json({
          value: {
            name: "World Only",
            endpoint: "wss://remote.example/ws",
            xrpcEndpoint: "https://remote.example/xrpc",
          },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const manager = makeManager();
    const server = await manager.resolveServer("did:plc:remote");
    expect(server).not.toBeNull();
    expect(server!.name).toBe("World Only");
    expect(server!.xrpcEndpoint).toBe("https://remote.example/xrpc");
  });

  test("caches resolved servers for subsequent calls", async () => {
    const urls = stubFetch((url) => {
      if (url.startsWith("https://plc.directory/")) return didDocResponse();
      return Response.json({
        value: { name: "Remote", endpoint: "wss://r.example/ws" },
      });
    });

    const manager = makeManager();
    await manager.resolveServer("did:plc:remote");
    const fetchesAfterFirst = urls.length;
    await manager.resolveServer("did:plc:remote");
    expect(urls.length).toBe(fetchesAfterFirst);
  });

  test("returns null when DID resolution fails", async () => {
    stubFetch(() => new Response("not found", { status: 404 }));
    const manager = makeManager();
    expect(await manager.resolveServer("did:plc:unknown")).toBeNull();
  });

  test("returns null when neither record exists", async () => {
    stubFetch((url) => {
      if (url.startsWith("https://plc.directory/")) return didDocResponse();
      return new Response("not found", { status: 404 });
    });
    const manager = makeManager();
    expect(await manager.resolveServer("did:plc:empty")).toBeNull();
  });
});

describe("FederationManager registration record", () => {
  test("publishRegistration writes the full 11-field record", async () => {
    const { manager, records } = captureManager();
    await manager.publishRegistration(3, 0);

    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.$type).toBe(NSID.FederationRegistration);
    expect(record.serverDid).toBe("did:plc:self");
    expect(record.name).toBe("Local Realm");
    expect(record.description).toBe("A test realm");
    expect(record.endpoint).toBe("https://local.example/ws");
    expect(record.xrpcEndpoint).toBe("https://local.example/xrpc");
    expect(record.trustPolicy).toBe("trust-all");
    expect(record.signingKey).toBe(Buffer.from(new Uint8Array([1, 2, 3])).toString("base64url"));
    expect(record.portalCount).toBe(3);
    expect(record.playerCount).toBe(0);
    expect(typeof record.createdAt).toBe("string");
    expect(typeof record.updatedAt).toBe("string");
  });

  test("updatePlayerCount preserves createdAt and portalCount, advances updatedAt", async () => {
    const { manager, records } = captureManager();

    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    await manager.publishRegistration(7, 0);

    // Time advances before the periodic update
    setSystemTime(new Date("2026-01-01T00:05:00.000Z"));
    await manager.updatePlayerCount(42);

    expect(records).toHaveLength(2);
    const [first, second] = records;

    // createdAt is creation time — must NOT be re-stamped on update
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.createdAt).toBe("2026-01-01T00:00:00.000Z");
    // updatedAt reflects the update time
    expect(second.updatedAt).toBe("2026-01-01T00:05:00.000Z");
    // portalCount is preserved from the last publish
    expect(second.portalCount).toBe(7);
    expect(second.playerCount).toBe(42);
  });
});
