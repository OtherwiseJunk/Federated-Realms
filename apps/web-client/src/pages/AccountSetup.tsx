import { useEffect, useState, type KeyboardEvent } from "react";
import { loadProfile } from "../connection/profile-storage.js";
import "./pages.css";

export interface AccountResult {
  mode: "oauth" | "dev" | "signup";
  handle: string;
  did?: string;
  pdsUrl?: string;
  authToken?: string;
}

interface Props {
  onComplete: (result: AccountResult) => void;
}

type SetupPhase = "menu" | "signin";

export function AccountSetup({ onComplete }: Props) {
  const savedProfile = loadProfile();
  const hasProfile = savedProfile && savedProfile.handle;

  const [phase, setPhase] = useState<SetupPhase>("menu");
  const [inputValue, setInputValue] = useState("");

  // Handle domain of the co-located PDS (from the hosting server's /info) —
  // lets local users type just "yourname" instead of the full handle.
  const [pdsHostname, setPdsHostname] = useState("");
  const [useLocalPds, setUseLocalPds] = useState(true);

  useEffect(() => {
    const origin = window.location.origin;
    if (!origin || origin.includes("localhost:5173")) return; // vite dev — no co-located server
    fetch(`${origin}/info`)
      .then((res) => res.json())
      .then((info: { pdsHostname?: string }) => {
        if (info?.pdsHostname) setPdsHostname(info.pdsHostname);
      })
      .catch(() => {});
  }, []);

  // A bare name (no dot) with the toggle on gets the local PDS domain appended;
  // anything containing a dot or a DID is passed through untouched.
  const localExpansion =
    useLocalPds && pdsHostname && inputValue.trim() && !inputValue.includes(".")
      ? `${inputValue.trim()}.${pdsHostname}`
      : "";

  function handleInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitSignin();
    }
    if (e.key === "Escape") {
      setPhase("menu");
    }
  }

  function submitSignin() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    onComplete({ mode: "oauth", handle: localExpansion || trimmed });
  }

  if (phase === "menu") {
    return (
      <div className="page-container">
        <h2 style={{ color: "var(--color-cyan)" }}>Account Setup</h2>
        <p className="dim">How would you like to connect?</p>

        <div className="account-menu">
          <button
            className="account-menu-item"
            onClick={() => {
              setInputValue("");
              setPhase("signin");
            }}
          >
            <span style={{ color: "var(--color-green)" }}>Sign in</span>
            <span className="dim">with an existing AT Proto account</span>
          </button>

          <button
            className="account-menu-item"
            onClick={() => onComplete({ mode: "signup", handle: "" })}
          >
            <span style={{ color: "var(--color-cyan)" }}>Create account</span>
            <span className="dim">register a new account on a server</span>
          </button>

          {hasProfile && (
            <button
              className="account-menu-item"
              onClick={() => {
                onComplete({
                  mode: "oauth",
                  handle: savedProfile!.handle,
                  did: savedProfile!.did,
                  pdsUrl: savedProfile!.pdsUrl,
                  authToken: savedProfile!.authToken,
                });
              }}
            >
              <span style={{ color: "var(--color-yellow)" }}>
                Continue as {savedProfile!.handle}
              </span>
              <span className="dim">use saved profile</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  const localMode = useLocalPds && pdsHostname;

  return (
    <div className="page-container">
      <h2 style={{ color: "var(--color-cyan)" }}>Sign In</h2>
      <p>
        {localMode
          ? "Enter your handle:"
          : "Enter your AT Protocol handle or DID:"}
      </p>

      <div className="page-input-row">
        <span className="input-prompt">&gt; </span>
        <input
          className="page-input"
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleInputKeyDown}
          autoFocus
          spellCheck={false}
          placeholder={localMode ? "yourname" : "yourname.bsky.social"}
        />
        <button className="page-button page-button-primary" onClick={submitSignin}>
          Sign In
        </button>
      </div>

      {pdsHostname && (
        <label className="dim" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="checkbox"
            checked={useLocalPds}
            onChange={(e) => setUseLocalPds(e.target.checked)}
          />
          My account is on this server ({pdsHostname})
        </label>
      )}

      {localExpansion ? (
        <p className="dim">Signing in as {localExpansion}</p>
      ) : (
        <p className="dim">
          {localMode
            ? "Full handles and DIDs also work here."
            : "e.g. yourname.bsky.social or yourname.your-server.com"}
        </p>
      )}

      <button className="page-button" onClick={() => setPhase("menu")}>
        Back
      </button>
    </div>
  );
}
