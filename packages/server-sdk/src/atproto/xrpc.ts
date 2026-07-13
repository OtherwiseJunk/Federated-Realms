/**
 * XRPC wire-format helpers — the single owner of XRPC URL construction and
 * DID → PDS → record resolution for the SDK.
 *
 * Endpoint invariant: an `xrpcEndpoint` (as published in `world.server` and
 * `federation.registration` records, and as stored on `KnownServer`) INCLUDES
 * the `/xrpc` path prefix, e.g. `https://realm.example/xrpc`. PDS service
 * endpoints from DID documents EXCLUDE it (e.g. `https://pds.example`).
 * `xrpcUrl()` accepts either form: `normalizeXrpcEndpoint()` defensively
 * reduces any input (bare origin, trailing slash, doubled `/xrpc`) to exactly
 * one `/xrpc` suffix, so a differently-published record cannot produce a
 * doubled-prefix 404.
 */

const XRPC_PREFIX = "/xrpc";
const GET_RECORD_NSID = "com.atproto.repo.getRecord";
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Normalize an endpoint to the canonical `xrpcEndpoint` form: no trailing
 * slash, exactly one trailing `/xrpc` segment.
 */
export function normalizeXrpcEndpoint(endpoint: string): string {
  let base = endpoint.replace(/\/+$/, "");
  while (base.endsWith(XRPC_PREFIX)) {
    base = base.slice(0, -XRPC_PREFIX.length).replace(/\/+$/, "");
  }
  return `${base}${XRPC_PREFIX}`;
}

/**
 * Build the URL for an XRPC method call. `endpoint` may be an `xrpcEndpoint`
 * (includes `/xrpc`) or a PDS service endpoint (excludes it) — see the
 * endpoint invariant above.
 */
export function xrpcUrl(endpoint: string, nsid: string, params?: Record<string, string>): string {
  const base = `${normalizeXrpcEndpoint(endpoint)}/${nsid}`;
  if (!params) return base;
  const query = new URLSearchParams(params).toString();
  return query ? `${base}?${query}` : base;
}

export interface DidDocumentService {
  id: string;
  type: string;
  serviceEndpoint: string;
}

export interface DidDocument {
  id?: string;
  service?: DidDocumentService[];
  [key: string]: unknown;
}

/**
 * Resolve a DID document. Supports `did:plc` (via plc.directory) and
 * `did:web` (via the domain's well-known document). Returns null for
 * unsupported methods or a non-ok response; network errors and timeouts
 * propagate to the caller.
 */
export async function resolveDidDocument(
  did: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<DidDocument | null> {
  let url: string;
  if (did.startsWith("did:plc:")) {
    url = `https://plc.directory/${did}`;
  } else if (did.startsWith("did:web:")) {
    const domain = did.replace("did:web:", "").replace(/:/g, "/");
    url = `https://${domain}/.well-known/did.json`;
  } else {
    return null;
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) return null;
  return (await res.json()) as DidDocument;
}

/**
 * Resolve a DID to its PDS service endpoint (the `AtprotoPersonalDataServer`
 * entry in the DID document). The returned endpoint does NOT include `/xrpc`.
 */
export async function resolvePdsEndpoint(
  did: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string | null> {
  const doc = await resolveDidDocument(did, timeoutMs);
  const service = doc?.service?.find((s) => s.type === "AtprotoPersonalDataServer");
  return service?.serviceEndpoint ?? null;
}

/**
 * Fetch a record's value via `com.atproto.repo.getRecord` on the given PDS.
 * Returns null when the record is missing (non-ok response); network errors
 * and timeouts propagate to the caller.
 */
export async function fetchRecord<T>(
  pdsEndpoint: string,
  repo: string,
  collection: string,
  rkey: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T | null> {
  const url = xrpcUrl(pdsEndpoint, GET_RECORD_NSID, { repo, collection, rkey });
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) return null;
  const data = (await res.json()) as { value: T };
  return data.value;
}
