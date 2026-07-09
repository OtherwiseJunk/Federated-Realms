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
        setPhase("waiting");

        window.open(url, "_blank", "noopener");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Authentication failed");
        setPhase("error");
      }
    })();
  }, [handle, serverUrl, signup, authToken, onComplete]);

  // Poll for OAuth result
  useEffect(() => {
    if (phase !== "waiting" || !ticket) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${serverUrl}/auth/poll?ticket=${encodeURIComponent(ticket)}`);
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
            A new window has been opened for {signup ? "registration" : "authentication"}.
          </p>
          <p>
            {signup
              ? "Create your account in the new window (handle, email, password), then return here."
              : "Please authorize Federated Realms in your browser, then return here."}
          </p>
          <p className="dim">Waiting for {signup ? "account creation" : "authorization"}...</p>
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
