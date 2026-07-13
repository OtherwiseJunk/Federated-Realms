import { afterEach, describe, expect, test } from "bun:test";
import { FederationManager } from "./federation-manager.js";
import type { ServerIdentity } from "../atproto/server-identity.js";
import type { FederationConfig, AtProtoConfig } from "../types/server-config.js";
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
