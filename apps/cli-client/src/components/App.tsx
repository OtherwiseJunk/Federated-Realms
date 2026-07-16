import React, { useCallback, useState, useEffect, useMemo } from "react";
import { Box, Text, useApp, useStdout, useInput } from "ink";
import { handleLocalPart } from "@realms/common";
import { WsClient } from "../connection/ws-client.js";
import { useGameState } from "../hooks/use-game-state.js";
import { StatusBar } from "./StatusBar.js";
import { RoomPanel } from "./RoomPanel.js";
import { CombatPanel, getCombatPanelHeight } from "./CombatPanel.js";
import { NarrativeView } from "./NarrativeView.js";
import { InputBar } from "./InputBar.js";
import { HintBar } from "./HintBar.js";
import { InfoPanel, INFO_PANEL_HEIGHT } from "./InfoPanel.js";
import { CharacterCreate } from "./CharacterCreate.js";
import { SplashScreen } from "./SplashScreen.js";
import { AccountSetup, type AccountResult } from "./AccountSetup.js";
import { ServerSelect } from "./ServerSelect.js";
import { OAuthFlow, type OAuthResult } from "./OAuthFlow.js";
import { saveProfile, loadProfile } from "../connection/saved-profile.js";

type AppPhase = "splash" | "account" | "server" | "authenticate" | "create" | "play" | "error";

interface SystemData {
  classes: Record<
    string,
    {
      name: string;
      description: string;
      attributeBonuses?: Record<string, number>;
      spells?: string[];
      tags?: string[];
    }
  >;
  races: Record<
    string,
    {
      name: string;
      description: string;
      attributeBonuses?: Record<string, number>;
      tags?: string[];
    }
  >;
}

interface ServerInfo {
  name: string;
  description: string;
  players: number;
  rooms: number;
}

export function App() {
  const { exit } = useApp();
  const [phase, setPhase] = useState<AppPhase>("splash");

  // Account state
  const [account, setAccount] = useState<AccountResult | null>(null);

  // Server state
  const [serverUrl, setServerUrl] = useState("");
  const [, setServerInfo] = useState<ServerInfo | null>(null);
  const [system, setSystem] = useState<SystemData | null>(null);

  // Character state
  const [playerName, setPlayerName] = useState("");
  const [finalClass, setFinalClass] = useState("warrior");
  const [finalRace, setFinalRace] = useState("human");

  // Auth result (session from auth flow)
  const [authSessionId, setAuthSessionId] = useState("");
  const [authToken, setAuthToken] = useState("");

  // Connection
  const [client, setClient] = useState<WsClient | null>(null);

  // Connect-flow error surfaced to the user (never console.error, which would
  // corrupt the Ink frame)
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ── Phase transitions ──

  const failWith = useCallback((message: string) => {
    setErrorMessage(message);
    setPhase("error");
  }, []);

  const handleRetry = useCallback(() => {
    setErrorMessage(null);
    setClient(null);
    setSystem(null);
    setAuthSessionId("");
    setPhase("server");
  }, []);

  const handleSplashDone = useCallback(() => {
    setPhase("account");
  }, []);

  const handleAccountDone = useCallback((result: AccountResult) => {
    setAccount(result);
    setPhase("server");
  }, []);

  const handleServerConnect = useCallback(
    (url: string, info: ServerInfo) => {
      setServerUrl(url);
      setServerInfo(info);

      // Save last server to profile, preserving prior identity/token when
      // this account result doesn't carry them (e.g. signup mode has no
      // handle yet, and this save happens before auth issues a token).
      if (account) {
        const prev = loadProfile();
        saveProfile({
          handle: account.handle || prev?.handle || "",
          did: account.did ?? prev?.did ?? "",
          pdsUrl: account.pdsUrl ?? prev?.pdsUrl ?? "",
          lastServer: url,
          lastServerName: info.name,
          authToken: account.authToken ?? prev?.authToken,
        });
      }

      // OAuth mode: go to authentication phase
      if (account?.mode === "oauth" || account?.mode === "signup") {
        setPhase("authenticate");
        return;
      }

      // Dev mode: fetch system data for character creation. A failed prereq
      // fetch must surface an error, not silently connect with hardcoded
      // warrior/human defaults.
      fetch(`${url}/system`)
        .then((res) => {
          if (!res.ok) throw new Error(`Server responded ${res.status}`);
          return res.json();
        })
        .then((data) => {
          setSystem(data as SystemData);
          if (account?.mode === "dev") {
            setPlayerName(account.handle);
          }
          setPhase("create");
        })
        .catch(() =>
          failWith(
            "Couldn't load this server's character options. Check the server address and try again.",
          ),
        );
    },
    [account, failWith],
  );

  const handleOAuthComplete = useCallback(
    (result: OAuthResult) => {
      if (result.authToken) setAuthToken(result.authToken);

      // Persist token + identity for "Continue as" next launch
      if (account) {
        const prev = loadProfile();
        saveProfile({
          handle: result.handle || account.handle || prev?.handle || (result.did ?? ""),
          did: result.did ?? prev?.did ?? "",
          pdsUrl: prev?.pdsUrl ?? "",
          lastServer: serverUrl,
          lastServerName: prev?.lastServerName,
          authToken: result.authToken,
        });
      }

      if (result.sessionId) {
        // Returning player — connect directly
        setAuthSessionId(result.sessionId);
        setPhase("play");
      } else if (result.needsCharacter) {
        // New player — needs character creation
        if (result.handle) setPlayerName(handleLocalPart(result.handle));
        if (result.gameSystem) {
          setSystem(result.gameSystem as SystemData);
          setPhase("create");
        } else {
          // Only enter character creation once the system data has loaded;
          // advancing first left `system` null and stuck on "Connecting...".
          fetch(`${serverUrl}/system`)
            .then((res) => {
              if (!res.ok) throw new Error(`Server responded ${res.status}`);
              return res.json();
            })
            .then((data) => {
              setSystem(data as SystemData);
              setPhase("create");
            })
            .catch(() =>
              failWith(
                "Couldn't load this server's character options. Check the server address and try again.",
              ),
            );
        }
      }
    },
    [account, serverUrl, failWith],
  );

  const handleCreateComplete = useCallback(
    (chosenName: string, chosenClass: string, chosenRace: string) => {
      setPlayerName(chosenName);
      setFinalClass(chosenClass);
      setFinalRace(chosenRace);
      setPhase("play");
    },
    [],
  );

  // ── Connect when entering play phase ──

  useEffect(() => {
    if (phase !== "play" || client) return;

    const c = new WsClient();

    if (account && account.mode !== "dev" && authSessionId && serverUrl) {
      // OAuth mode: connect with session from auth flow
      const wsUrl = serverUrl.replace(/^http/, "ws") + "/ws";
      c.connectWithSession({ url: wsUrl, sessionId: authSessionId });
    } else if (account && account.mode !== "dev" && authToken && serverUrl) {
      // New character needed after OAuth — authenticated by bearer token
      (async () => {
        try {
          const res = await fetch(
            `${serverUrl}/xrpc/com.cacheblasters.realms.action.createCharacter`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`,
              },
              body: JSON.stringify({
                name: playerName,
                classId: finalClass,
                raceId: finalRace,
              }),
            },
          );
          if (!res.ok) throw new Error("Character creation failed");
          const data = (await res.json()) as { sessionId: string; websocketUrl: string };
          c.connectWithSession({ url: data.websocketUrl.split("?")[0], sessionId: data.sessionId });
        } catch {
          failWith("Couldn't create your character on this server. Please try again.");
        }
      })();
    } else if (account?.mode === "dev" && serverUrl) {
      // Dev mode: connect with query params
      const url = new URL(serverUrl);
      c.connect({
        host: url.hostname,
        port: parseInt(url.port || (url.protocol === "https:" ? "443" : "80"), 10),
        tls: url.protocol === "https:",
        name: playerName,
        classId: finalClass,
        raceId: finalRace,
      });
    }

    setClient(c);
  }, [
    phase,
    client,
    account,
    serverUrl,
    playerName,
    finalClass,
    finalRace,
    authSessionId,
    authToken,
    failWith,
  ]);

  // ── Render phases ──

  if (phase === "splash") {
    return <SplashScreen onContinue={handleSplashDone} />;
  }

  if (phase === "account") {
    return <AccountSetup onComplete={handleAccountDone} />;
  }

  if (phase === "server") {
    const saved = loadProfile();
    return <ServerSelect savedProfile={saved} onConnect={handleServerConnect} />;
  }

  if (phase === "authenticate" && account && serverUrl) {
    return (
      <OAuthFlow
        handle={account.handle}
        serverUrl={serverUrl}
        signup={account.mode === "signup"}
        authToken={account.authToken}
        onComplete={handleOAuthComplete}
      />
    );
  }

  if (phase === "create" && system) {
    const classList = Object.entries(system.classes).map(([id, def]) => ({ id, ...def }));
    const raceList = Object.entries(system.races).map(([id, def]) => ({ id, ...def }));
    const name = playerName || account?.handle || "";

    return (
      <CharacterCreate
        classes={classList}
        races={raceList}
        playerName={name}
        onComplete={handleCreateComplete}
      />
    );
  }

  if (phase === "error") {
    return <ErrorScreen message={errorMessage ?? "Something went wrong."} onRetry={handleRetry} />;
  }

  if (!client) {
    return (
      <Box paddingX={1}>
        <Text color="yellow">Connecting...</Text>
      </Box>
    );
  }

  return <GameView client={client} name={playerName || account?.handle || ""} exit={exit} />;
}

// ── Game View (unchanged layout logic) ──

const ROOM_DESC_LINES = 3;
const ROOM_PANEL_HEIGHT = 7;
const CHROME_ROWS = 7; // status(3) + input(3) + hints(1)

function GameView({ client, name, exit }: { client: WsClient; name: string; exit: () => void }) {
  const { stdout } = useStdout();
  const state = useGameState(client);
  const [connecting, setConnecting] = useState(true);
  const [rows, setRows] = useState(stdout.rows ?? 24);
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);

  useEffect(() => {
    if (state.connected) setConnecting(false);
  }, [state.connected]);

  // A socket that fails to connect (or drops before it ever connected) must
  // leave the "Connecting..." state so the status bar reports "Disconnected"
  // instead of hanging forever.
  useEffect(() => {
    const unsubscribe = client.onMessage((msg) => {
      if (msg.type === "error" && (msg.code === "DISCONNECTED" || msg.code === "CONNECT_ERROR")) {
        setConnecting(false);
      }
    });
    return unsubscribe;
  }, [client]);

  // Handle portal offers — auto-switch server
  useEffect(() => {
    if (!state.portalOffer) return;
    const { websocketUrl, sessionId } = state.portalOffer;
    client.switchServer(websocketUrl, sessionId);
  }, [state.portalOffer, client]);

  // Track terminal resize
  useEffect(() => {
    const onResize = () => setRows(stdout.rows ?? 24);
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  // Tab toggles info panel
  useInput((_input, key) => {
    if (key.tab) {
      setInfoPanelOpen((prev) => !prev);
    }
  });

  const handleCommand = useCallback(
    (input: string) => {
      if (input === "quit" || input === "disconnect") {
        client.disconnect();
        setTimeout(() => exit(), 200);
        return;
      }
      client.sendCommand(input);
    },
    [client, exit],
  );

  const inCombat = state.combat?.active ?? false;
  const cols = stdout.columns ?? 80;

  const contextPanelHeight = useMemo(() => {
    if (inCombat && state.combat) {
      const hasArt = state.combat.combatants.some(
        (c) => c.id === state.combat!.targetId && c.art && c.art.length > 0,
      );
      return getCombatPanelHeight(state.combat.combatants.length, hasArt);
    }
    return ROOM_PANEL_HEIGHT;
  }, [inCombat, state.combat]);

  const fixedRows = CHROME_ROWS + contextPanelHeight + (infoPanelOpen ? INFO_PANEL_HEIGHT : 0);
  const narrativeHeight = Math.max(rows - fixedRows, 3);

  return (
    <Box flexDirection="column" height={rows}>
      {infoPanelOpen && <InfoPanel state={state} playerName={name} width={cols} />}

      <StatusBar state={state} playerName={name} connecting={connecting} />

      {inCombat && state.combat ? (
        <CombatPanel combat={state.combat} width={cols} />
      ) : state.room ? (
        <RoomPanel room={state.room} playerName={name} maxDescLines={ROOM_DESC_LINES} />
      ) : null}

      <Box flexGrow={1} flexDirection="column" overflow="hidden">
        <NarrativeView lines={state.narrative} height={narrativeHeight} />
      </Box>

      <InputBar onSubmit={handleCommand} />
      <HintBar infoPanelOpen={infoPanelOpen} quests={state.quests} />
    </Box>
  );
}

// ── Error screen ──

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  useInput((input, key) => {
    if (key.return || input === "r") onRetry();
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text color="red" bold>
        Connection failed
      </Text>
      <Box height={1} />
      <Text color="red">{message}</Text>
      <Box height={1} />
      <Text color="gray" dimColor>
        Press Enter or R to try again.
      </Text>
    </Box>
  );
}
