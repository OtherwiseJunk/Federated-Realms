import React, { useEffect, useState, useRef } from "react";
import { Box, Text } from "ink";

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
  signup?: boolean;
  authToken?: string;
  onComplete: (result: OAuthResult) => void;
}

type FlowPhase = "starting" | "waiting" | "complete" | "error";

export function OAuthFlow({ handle, serverUrl, signup, authToken, onComplete }: Props) {
  const [phase, setPhase] = useState<FlowPhase>("starting");
  const [error, setError] = useState("");
  const [ticket, setTicket] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      // Fast path: stored token still valid → no browser round-trip needed
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

        const { exec } = await import("child_process");
        const openCmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        exec(`${openCmd} "${url}"`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Authentication failed");
        setPhase("error");
      }
    })();
  }, [handle, serverUrl, signup, authToken, onComplete]);

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
        // keep polling
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [phase, ticket, serverUrl, onComplete]);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text color="cyan" bold>
        {signup ? "Create Account" : "Sign In"}
      </Text>
      <Box height={1} />

      {phase === "starting" && (
        <Text color="yellow">
          {signup ? "Starting registration..." : `Starting authentication for ${handle}...`}
        </Text>
      )}

      {phase === "waiting" && (
        <>
          <Text color="green">
            A browser window has been opened for {signup ? "registration" : "authentication"}.
          </Text>
          <Box height={1} />
          <Text>
            {signup
              ? "Create your account in the browser (handle, email, password), then return here."
              : "Please authorize Federated Realms in your browser, then return here."}
          </Text>
          <Box height={1} />
          <Text color="gray" dimColor>
            Waiting...
          </Text>
        </>
      )}

      {phase === "error" && (
        <>
          <Text color="red">Authentication failed: {error}</Text>
          <Box height={1} />
          <Text color="gray" dimColor>
            Try running the server with DEV_MODE=true for local development.
          </Text>
        </>
      )}

      {phase === "complete" && <Text color="green">Authentication successful! Connecting...</Text>}
    </Box>
  );
}
