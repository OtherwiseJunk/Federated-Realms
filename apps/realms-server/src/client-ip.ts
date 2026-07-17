/**
 * Derive a trustworthy client IP for use as a rate-limit key.
 *
 * `X-Forwarded-For` is a client-supplied header: an attacker can prepend any
 * value, and each proxy the request traverses *appends* the address it saw. So
 * the entries added by our own (trusted) reverse proxies are the rightmost
 * ones, and the leftmost entries are attacker-controlled. To resist spoofing we
 * count `trustedProxyHops` in from the right — the entry inserted by the
 * outermost proxy we trust — rather than taking the leftmost value.
 *
 * @param forwardedFor  Raw `X-Forwarded-For` header value (may be null/empty).
 * @param trustedProxyHops  Number of reverse proxies in front of this server
 *   whose appended entries we trust (e.g. 1 for a single host nginx). 0 means
 *   trust none — the header is ignored entirely.
 * @param socketAddress  The peer socket address (Bun `server.requestIP().address`),
 *   used as a safe fallback when the header can't be trusted.
 * @returns The resolved client IP, or `"unknown"` if nothing usable is available.
 */
export function resolveClientIp(
  forwardedFor: string | null | undefined,
  trustedProxyHops: number,
  socketAddress: string | null | undefined,
): string {
  const fallback = socketAddress?.trim() || "unknown";

  // No trusted proxies: the header is entirely client-controlled — ignore it.
  if (trustedProxyHops <= 0) return fallback;
  if (!forwardedFor) return fallback;

  const chain = forwardedFor
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  // Position of the entry added by the outermost trusted proxy, counted from
  // the right end of the chain.
  const index = chain.length - trustedProxyHops;

  // Chain shorter than the trusted-hop count means it wasn't populated by our
  // proxies as expected (e.g. a direct client sending a short spoofed header);
  // don't trust any of it — fall back to the real socket address.
  if (index < 0) return fallback;

  return chain[index] || fallback;
}
