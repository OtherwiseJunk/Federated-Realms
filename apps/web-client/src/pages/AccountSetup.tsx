import { useState, type KeyboardEvent } from "react";
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
    onComplete({ mode: "oauth", handle: trimmed });
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

  return (
    <div className="page-container">
      <h2 style={{ color: "var(--color-cyan)" }}>Sign In</h2>
      <p>Enter your AT Protocol handle or DID:</p>

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
          placeholder="yourname.bsky.social"
        />
        <button className="page-button page-button-primary" onClick={submitSignin}>
          Sign In
        </button>
      </div>

      <p className="dim">e.g. yourname.bsky.social or yourname.your-server.com</p>
      <button className="page-button" onClick={() => setPhase("menu")}>
        Back
      </button>
    </div>
  );
}
