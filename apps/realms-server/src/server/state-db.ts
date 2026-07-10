import { Database } from "bun:sqlite";
import { accessSync, constants, mkdirSync } from "node:fs";
import { join } from "node:path";

export function openStateDatabase(dataDir: string): Database {
  try {
    mkdirSync(dataDir, { recursive: true });
    accessSync(dataDir, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch (error) {
    throw new Error(
      `State directory "${dataDir}" is not writable. Check DATA_DIR and the mounted volume permissions. ${formatError(error)}`,
      { cause: error },
    );
  }

  const dbPath = join(dataDir, "realms.db");

  try {
    return new Database(dbPath);
  } catch (error) {
    throw new Error(
      `Unable to open SQLite state database at "${dbPath}". Check DATA_DIR and the mounted volume permissions. ${formatError(error)}`,
      { cause: error },
    );
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
