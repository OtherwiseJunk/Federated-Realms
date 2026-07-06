import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDatabase } from "./state-db.js";

describe("openStateDatabase", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("creates the state directory and opens realms.db", () => {
    const root = mkdtempSync(join(tmpdir(), "realms-state-"));
    tempRoots.push(root);
    const dataDir = join(root, "state");

    const db = openStateDatabase(dataDir);
    db.close();

    expect(existsSync(join(dataDir, "realms.db"))).toBe(true);
  });

  test("reports DATA_DIR problems before opening sqlite", () => {
    const root = mkdtempSync(join(tmpdir(), "realms-state-"));
    tempRoots.push(root);
    const dataDir = join(root, "not-a-dir");
    writeFileSync(dataDir, "");

    expect(() => openStateDatabase(dataDir)).toThrow(/State directory .*DATA_DIR/);
  });
});
