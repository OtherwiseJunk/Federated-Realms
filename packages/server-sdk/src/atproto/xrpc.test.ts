import { afterEach, describe, expect, test } from "bun:test";
import {
  normalizeXrpcEndpoint,
  xrpcUrl,
  resolveDidDocument,
  resolvePdsEndpoint,
  fetchRecord,
} from "./xrpc.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replace globalThis.fetch, capturing requested URLs. */
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

describe("normalizeXrpcEndpoint", () => {
  test("keeps an endpoint that already includes /xrpc", () => {
    expect(normalizeXrpcEndpoint("https://realm.example/xrpc")).toBe("https://realm.example/xrpc");
  });

  test("appends /xrpc to a bare origin", () => {
    expect(normalizeXrpcEndpoint("https://realm.example")).toBe("https://realm.example/xrpc");
  });

  test("strips trailing slashes", () => {
    expect(normalizeXrpcEndpoint("https://realm.example/")).toBe("https://realm.example/xrpc");
    expect(normalizeXrpcEndpoint("https://realm.example/xrpc/")).toBe("https://realm.example/xrpc");
  });

  test("collapses a doubled /xrpc prefix", () => {
    expect(normalizeXrpcEndpoint("https://realm.example/xrpc/xrpc")).toBe(
      "https://realm.example/xrpc",
    );
  });

  test("preserves a base path before the prefix", () => {
    expect(normalizeXrpcEndpoint("https://realm.example/game")).toBe(
      "https://realm.example/game/xrpc",
    );
    expect(normalizeXrpcEndpoint("https://realm.example/game/xrpc")).toBe(
      "https://realm.example/game/xrpc",
    );
  });
});

describe("xrpcUrl", () => {
  test("appends the NSID to an /xrpc-prefixed endpoint without doubling the prefix", () => {
    expect(xrpcUrl("https://realm.example/xrpc", "com.example.method")).toBe(
      "https://realm.example/xrpc/com.example.method",
    );
  });

  test("adds the /xrpc prefix when the endpoint lacks it", () => {
    expect(xrpcUrl("https://realm.example", "com.example.method")).toBe(
      "https://realm.example/xrpc/com.example.method",
    );
  });

  test("handles trailing slashes on the endpoint", () => {
    expect(xrpcUrl("https://realm.example/xrpc/", "com.example.method")).toBe(
      "https://realm.example/xrpc/com.example.method",
    );
  });

  test("encodes query parameters", () => {
    expect(
      xrpcUrl("https://realm.example/xrpc", "com.example.method", {
        repo: "did:plc:abc123",
        name: "Sir Robin",
      }),
    ).toBe("https://realm.example/xrpc/com.example.method?repo=did%3Aplc%3Aabc123&name=Sir+Robin");
  });

  test("omits the query string when params are empty", () => {
    expect(xrpcUrl("https://realm.example/xrpc", "com.example.method", {})).toBe(
      "https://realm.example/xrpc/com.example.method",
    );
  });
});

describe("resolveDidDocument", () => {
  test("resolves did:plc via plc.directory", async () => {
    const urls = stubFetch(() => Response.json({ id: "did:plc:abc" }));
    const doc = await resolveDidDocument("did:plc:abc");
    expect(urls).toEqual(["https://plc.directory/did:plc:abc"]);
    expect(doc?.id).toBe("did:plc:abc");
  });

  test("resolves did:web via .well-known", async () => {
    const urls = stubFetch(() => Response.json({ id: "did:web:realm.example" }));
    const doc = await resolveDidDocument("did:web:realm.example");
    expect(urls).toEqual(["https://realm.example/.well-known/did.json"]);
    expect(doc?.id).toBe("did:web:realm.example");
  });

  test("returns null for unsupported DID methods", async () => {
    const urls = stubFetch(() => Response.json({}));
    expect(await resolveDidDocument("did:key:z6Mk")).toBeNull();
    expect(urls).toEqual([]);
  });

  test("returns null on a non-ok response", async () => {
    stubFetch(() => new Response("not found", { status: 404 }));
    expect(await resolveDidDocument("did:plc:missing")).toBeNull();
  });
});

describe("resolvePdsEndpoint", () => {
  test("finds the AtprotoPersonalDataServer service endpoint", async () => {
    stubFetch(() =>
      Response.json({
        service: [
          { id: "#other", type: "SomethingElse", serviceEndpoint: "https://other.example" },
          {
            id: "#atproto_pds",
            type: "AtprotoPersonalDataServer",
            serviceEndpoint: "https://pds.example",
          },
        ],
      }),
    );
    expect(await resolvePdsEndpoint("did:plc:abc")).toBe("https://pds.example");
  });

  test("returns null when the document has no PDS service", async () => {
    stubFetch(() => Response.json({ service: [] }));
    expect(await resolvePdsEndpoint("did:plc:abc")).toBeNull();
  });
});

describe("fetchRecord", () => {
  test("builds the getRecord URL from the PDS endpoint and returns the record value", async () => {
    const urls = stubFetch(() => Response.json({ uri: "at://x", value: { name: "Remote" } }));
    const value = await fetchRecord<{ name: string }>(
      "https://pds.example",
      "did:plc:abc",
      "com.example.collection",
      "self",
    );
    expect(urls).toEqual([
      "https://pds.example/xrpc/com.atproto.repo.getRecord?repo=did%3Aplc%3Aabc&collection=com.example.collection&rkey=self",
    ]);
    expect(value?.name).toBe("Remote");
  });

  test("returns null on a non-ok response", async () => {
    stubFetch(() => new Response("nope", { status: 400 }));
    const value = await fetchRecord("https://pds.example", "did:plc:abc", "com.example.c", "self");
    expect(value).toBeNull();
  });
});
