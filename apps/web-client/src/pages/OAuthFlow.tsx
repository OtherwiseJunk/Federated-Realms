import { useEffect, useState, useRef } from "react";
import "./pages.css";

export interface OAuthResult {
  sessionId?: string;
  websocketUrl?: string;
  did?: string;
  handle?: string;
  needsCharacter?: boolean;
  gameSystem?: unknown;
  authToken?: string;
}

interface Props {
  handle: string;
  serverUrl: string;
  /** Register a new account on the server's own PDS instead of logging in. */
  signup?: boolean;
  /** Previously stored token — tried first to skip the OAuth popup. */
  authToken?: string;
  onComplete: (result: OAuthResult) => void;
}

type FlowPhase = "starting" | "waiting" | "complete" | "error";

export function OAuthFlow({ handle, serverUrl, signup, authToken, onComplete }: Props) {
  const [phase, setPhase] = useState<FlowPhase>("starting");
  const [error, setError] = useState("");
  const [ticket, setTicket] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const started = useRef(false);

  // Start: try stored token, else begin OAuth
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      // Fast path: stored token still valid → no OAuth popup needed
      if (authToken) {
        try {
          const res = await fetch(`${serverUrl}/xrpc/com.cacheblasters.realms.action.connect`, {
            method: "POST",
            headers: { Authorization: `Bearer ${authToken}` },
          });
          if (res.ok) {
            const data = (await res.json()) as OAuthResult;
            setPhase("complete");
            onComplete({ ...data, authToken });
            return;
          }
          // 401 → token expired; fall through to OAuth
        } catch {
          // network error → fall through to OAuth
        }
      }

      try {
        const query = signup ? "signup=true" : `handle=${encodeURIComponent(handle)}`;
        const res = await fetch(`${serverUrl}/auth/login?${query}`);
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `Login failed (${res.status})`);
        }

        const { url, ticket: t } = (await res.json()) as { url: string; ticket: string };
        setTicket(t);
        setAuthUrl(url);
        setPhase("waiting");

        // Centered popup window (the callback page closes it when done).
        // If a popup blocker eats it, the waiting screen shows a manual link.
        const w = 520;
        const h = 720;
        const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
        const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
        window.open(url, "atproto-oauth", `popup,width=${w},height=${h},left=${left},top=${top}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Authentication failed");
        setPhase("error");
      }
    })();
  }, [handle, serverUrl, signup, authToken, onComplete]);

  // Poll for OAuth result
  useEffect(() => {
    if (phase !== "waiting" || !ticket) return;

    const pollStart = Date.now();
    const POLL_TIMEOUT_MS = 15 * 60 * 1000;

    const interval = setInterval(async () => {
      if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
        clearInterval(interval);
        setError("Login attempt expired. Please try again.");
        setPhase("error");
        return;
      }

      try {
        const res = await fetch(`${serverUrl}/auth/poll?ticket=${encodeURIComponent(ticket)}`);
        if (res.status === 404) {
          clearInterval(interval);
          setError("Login attempt expired. Please try again.");
          setPhase("error");
          return;
        }
        if (!res.ok) return;

        const data = (await res.json()) as {
          status: string;
          sessionId?: string;
          websocketUrl?: string;
          did?: string;
          handle?: string;
          authToken?: string;
          needsCharacter?: boolean;
          gameSystem?: unknown;
          error?: string;
        };

        if (data.status === "pending") return;

        clearInterval(interval);

        if (data.status === "error") {
          setError(data.error ?? "Authentication failed");
          setPhase("error");
          return;
        }

        setPhase("complete");
        onComplete({
          sessionId: data.sessionId,
          websocketUrl: data.websocketUrl,
          did: data.did,
          handle: data.handle,
          authToken: data.authToken,
          needsCharacter: data.needsCharacter,
          gameSystem: data.gameSystem,
        });
      } catch {
        // Network error — keep polling
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [phase, ticket, serverUrl, onComplete]);

  const title = signup ? "Create Account" : "Sign In";

  return (
    <div className="page-container">
      <h2 style={{ color: "var(--color-cyan)" }}>{title}</h2>

      {phase === "starting" && (
        <p style={{ color: "var(--color-yellow)" }}>
          {signup ? "Starting registration..." : `Starting authentication for ${handle}...`}
        </p>
      )}

      {phase === "waiting" && (
        <>
          <p style={{ color: "var(--color-green)" }}>
            A {signup ? "registration" : "sign-in"} window has been opened.
          </p>
          <p>
            {signup
              ? "Create your account there (handle, email, password) — this page will continue automatically."
              : "Authorize Federated Realms there — this page will continue automatically."}
          </p>
          <p className="dim">Waiting for {signup ? "account creation" : "authorization"}...</p>
          {authUrl && (
            <p className="dim">
              Nothing opened?{" "}
              <a href={authUrl} target="_blank" rel="noopener noreferrer">
                Open the {signup ? "registration" : "sign-in"} page manually
              </a>
              .
            </p>
          )}
        </>
      )}

      {phase === "error" && (
        <p style={{ color: "var(--color-red)" }}>Authentication failed: {error}</p>
      )}

      {phase === "complete" && (
        <p style={{ color: "var(--color-green)" }}>Authentication successful! Connecting...</p>
      )}
    </div>
  );
}
