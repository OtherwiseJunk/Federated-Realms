#!/usr/bin/env bun
/**
 * Federated Realms — Reset "Adventurer" character records
 *
 * One-off, operator-run tool for GH issue #74: deletes the self
 * CharacterProfile record for each given DID, so the next connect finds no
 * record, returns `needsCharacter`, and the player re-creates their
 * character through the fixed flow.
 *
 * Restores each DID's OAuth session via the same oauthClient/session store
 * the running server uses (DATA_DIR must point at that server's state dir),
 * then calls PdsClient.deleteCharacter. Skips DIDs with no valid session —
 * those players just re-authenticate and will be prompted to create a
 * character on next connect regardless, since loadCharacter will find
 * nothing.
 *
 * Destructive and one-time: not wired into server startup, no automated
 * test beyond the unit-tested PdsClient.deleteCharacter.
 *
 * Usage:
 *   bun run apps/realms-server/scripts/reset-characters.ts <did> [<did> ...]
 */
import {
  loadConfig,
  openStateDatabase,
  SqliteSimpleStore,
  ServerIdentity,
  GameOAuthClient,
  PdsClient,
} from "@realms/server-sdk";

async function main(): Promise<void> {
  const dids = process.argv.slice(2);
  if (dids.length === 0) {
    console.error(
      "Usage: bun run apps/realms-server/scripts/reset-characters.ts <did> [<did> ...]",
    );
    process.exit(1);
  }

  const config = loadConfig(decodeURIComponent(new URL("../data", import.meta.url).pathname));
  const stateDb = openStateDatabase(config.dataDir);

  const oauthClient = new GameOAuthClient();
  await oauthClient.initialize(config.atproto, {
    stateStore: new SqliteSimpleStore(stateDb, "oauth_state"),
    sessionStore: new SqliteSimpleStore(stateDb, "oauth_session"),
  });

  // deleteCharacter never touches serverIdentity, so an uninitialized
  // instance is fine here — no PDS login or signing key required.
  const pdsClient = new PdsClient(new ServerIdentity());

  for (const did of dids) {
    const agent = await oauthClient.restore(did);
    if (!agent) {
      console.warn(`  Skipped ${did}: no valid OAuth session to restore`);
      continue;
    }
    try {
      await pdsClient.deleteCharacter(agent, did);
      console.log(`  Deleted character record for ${did}`);
    } catch (err) {
      console.error(
        `  Failed to delete character record for ${did}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  stateDb.close();
}

main();
