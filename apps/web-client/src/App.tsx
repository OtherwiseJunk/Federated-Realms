import { useCallback, useState, useEffect } from "react";
import { WsClient } from "./connection/ws-client.js";
import { useGameState } from "./hooks/use-game-state.js";
import { SPLASH_ART, SPLASH_SUBTITLE, SPLASH_BYLINE } from "@realms/client-common";
import { handleLocalPart } from "@realms/common";
import { saveProfile, loadProfile } from "./connection/profile-storage.js";
import { StatusBar } from "./components/StatusBar.js";
import { RoomPanel } from "./components/RoomPanel.js";
import { CombatPanel } from "./components/CombatPanel.js";
import { NarrativeView } from "./components/NarrativeView.js";
import { InputBar } from "./components/InputBar.js";
import { HintBar } from "./components/HintBar.js";
import { InfoPanel } from "./components/InfoPanel.js";
import { CharacterCreate } from "./pages/CharacterCreate.js";
import { ServerSelect } from "./pages/ServerSelect.js";
import { AccountSetup, type AccountResult } from "./pages/AccountSetup.js";
import { OAuthFlow, type OAuthResult } from "./pages/OAuthFlow.js";
import "./App.css";

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

  // Auth result
  const [authSessionId, setAuthSessionId] = useState("");
  const [authToken, setAuthToken] = useState("");

  // Connection
  const [client, setClient] = useState<WsClient | null>(null);

  // Connect-flow error surfaced to the user (never silently swallowed)
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // -- Phase transitions --

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
        setAuthSessionId(result.sessionId);
        setPhase("play");
      } else if (result.needsCharacter) {
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

  // -- Connect when entering play phase --

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
          const data = (await res.json()) as {
            sessionId: string;
            websocketUrl: string;
          };
          c.connectWithSession({
            url: data.websocketUrl.split("?")[0],
            sessionId: data.sessionId,
          });
        } catch {
          failWith("Couldn't create your character on this server. Please try again.");
        }
      })();
    } else if (serverUrl) {
      // Dev mode or fallback: connect with query params
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

  // -- Render phases --

  if (phase === "error") {
    return (
      <div className="page-container">
        <h2 style={{ color: "var(--color-red)" }}>Connection failed</h2>
        <p style={{ color: "var(--color-red)" }}>{errorMessage}</p>
        <button className="page-button page-button-primary" onClick={handleRetry}>
          Try again
        </button>
      </div>
    );
  }

  if (phase === "splash") {
    return (
      <div className="splash-container">
        <pre className="splash-art">{SPLASH_ART.join("\n")}</pre>
        <div className="splash-subtitle">{SPLASH_SUBTITLE}</div>
        <div className="dim">{SPLASH_BYLINE}</div>
        <div style={{ display: "flex", gap: "12px" }}>
          <button className="page-button page-button-primary" onClick={() => setPhase("account")}>
            Enter the Realm
          </button>
        </div>
      </div>
    );
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
    const classList = Object.entries(system.classes).map(([id, def]) => ({
      id,
      ...def,
    }));
    const raceList = Object.entries(system.races).map(([id, def]) => ({
      id,
      ...def,
    }));
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

  if (!client) {
    return (
      <div className="splash-container">
        <div style={{ color: "var(--color-yellow)" }}>Connecting...</div>
      </div>
    );
  }

  return <GameView client={client} name={playerName || account?.handle || ""} />;
}

// -- Game View --

function GameView({ client, name }: { client: WsClient; name: string }) {
  const state = useGameState(client);
  const [connecting, setConnecting] = useState(true);
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

  // Portal auto-switch
  useEffect(() => {
    if (!state.portalOffer) return;
    const { websocketUrl, sessionId } = state.portalOffer;
    client.switchServer(websocketUrl, sessionId);
  }, [state.portalOffer, client]);

  // Tab key toggles info panel
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Tab") {
        e.preventDefault();
        setInfoPanelOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleCommand = useCallback(
    (input: string) => {
      client.sendCommand(input);
    },
    [client],
  );

  const inCombat = state.combat?.active ?? false;

  return (
    <div className="game-layout">
      {infoPanelOpen && <InfoPanel state={state} playerName={name} />}

      <StatusBar state={state} playerName={name} connecting={connecting} />

      {inCombat && state.combat ? (
        <CombatPanel combat={state.combat} onCommand={handleCommand} />
      ) : state.room ? (
        <RoomPanel room={state.room} playerName={name} onCommand={handleCommand} />
      ) : null}

      <NarrativeView lines={state.narrative} />

      <InputBar onSubmit={handleCommand} />
      <HintBar
        infoPanelOpen={infoPanelOpen}
        quests={state.quests}
        onToggleInfo={() => setInfoPanelOpen((prev) => !prev)}
        onCommand={handleCommand}
      />
    </div>
  );
}
