import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { loadProfile } from "../connection/saved-profile.js";

type SetupPhase = "menu" | "signin";

interface Props {
  onComplete: (result: AccountResult) => void;
}

export interface AccountResult {
  mode: "oauth" | "dev" | "signup";
  handle: string;
  did?: string;
  pdsUrl?: string;
  authToken?: string;
}

const DEV_MODE = process.env.DEV_MODE === "true";

export function AccountSetup({ onComplete }: Props) {
  const savedProfile = loadProfile();
  const hasProfile = savedProfile && savedProfile.handle;

  const [phase, setPhase] = useState<SetupPhase>("menu");
  const [menuIndex, setMenuIndex] = useState(0);
  const [inputValue, setInputValue] = useState("");

  const menuItems = [
    { label: "Sign in with existing account", value: "signin" as const },
    { label: "Create a new account", value: "signup" as const },
    ...(hasProfile
      ? [{ label: `Continue as ${savedProfile!.handle}`, value: "saved" as const }]
      : []),
    ...(DEV_MODE ? [{ label: "Quick connect (dev mode)", value: "dev" as const }] : []),
  ];

  useInput((input, key) => {
    if (phase === "menu") {
      if (key.upArrow) {
        setMenuIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setMenuIndex((i) => Math.min(menuItems.length - 1, i + 1));
      } else if (key.return) {
        const selected = menuItems[menuIndex];
        if (selected.value === "saved" && hasProfile) {
          onComplete({
            mode: "oauth",
            handle: savedProfile!.handle,
            did: savedProfile!.did,
            pdsUrl: savedProfile!.pdsUrl,
            authToken: savedProfile!.authToken,
          });
        } else if (selected.value === "signin") {
          setPhase("signin");
          setInputValue("");
        } else if (selected.value === "signup") {
          onComplete({ mode: "signup", handle: "" });
        } else if (selected.value === "dev") {
          onComplete({ mode: "dev", handle: `Player_${Math.floor(Math.random() * 9999)}` });
        }
      }
      return;
    }

    // Text input phase — Esc goes back
    if (key.escape) {
      if (phase === "signin") {
        setPhase("menu");
      }
      return;
    }

    if (key.return) {
      const trimmed = inputValue.trim();
      if (!trimmed) return;

      if (phase === "signin") {
        onComplete({ mode: "oauth", handle: trimmed });
        return;
      }
    }

    if (key.backspace || key.delete) {
      setInputValue((prev) => prev.slice(0, -1));
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setInputValue((prev) => prev + input);
    }
  });

  // ── Render ──

  if (phase === "menu") {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="cyan" bold>
          Account Setup
        </Text>
        <Box height={1} />

        <Text>How would you like to connect?</Text>
        <Box height={1} />

        {menuItems.map((item, i) => (
          <Box key={item.value}>
            <Text color={i === menuIndex ? "cyan" : "white"}>
              {i === menuIndex ? " > " : "   "}
              {item.label}
            </Text>
          </Box>
        ))}

        <Box height={1} />
        <Text color="gray" dimColor>
          Use arrow keys to select, Enter to confirm
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text color="cyan" bold>
        Sign In
      </Text>
      <Box height={1} />

      <Text>Enter your AT Protocol handle or DID:</Text>
      <Box height={1} />

      <Box>
        <Text color="green" bold>
          {"> "}
        </Text>
        <Text>{inputValue}</Text>
        <Text color="gray">{"█"}</Text>
      </Box>

      <Box height={1} />
      <Text color="gray" dimColor>
        e.g. yourname.bsky.social or yourname.your-server.com
      </Text>
      <Box height={1} />
      <Text color="gray" dimColor>
        Esc to go back
      </Text>
    </Box>
  );
}
