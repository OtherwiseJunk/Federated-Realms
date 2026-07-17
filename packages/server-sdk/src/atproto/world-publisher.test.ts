import { afterEach, describe, expect, test, spyOn } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AtpAgent } from "@atproto/api";
import { NSID } from "@realms/lexicons";
import { WorldPublisher } from "./world-publisher.js";
import { NpcManager } from "../entities/npc-manager.js";
import { QuestManager } from "../systems/quest-manager.js";
import { CraftingSystem } from "../systems/crafting-system.js";
import { AreaManager } from "../world/area-manager.js";
import type { WorldManager } from "../world/world-manager.js";

interface CapturedRecord {
  collection: string;
  rkey: string;
  record: Record<string, unknown>;
}

/** Build a capturing AtpAgent stub. When `fail` is true every putRecord rejects. */
function makeAgent(fail = false): { agent: AtpAgent; records: CapturedRecord[] } {
  const records: CapturedRecord[] = [];
  const agent = {
    com: {
      atproto: {
        repo: {
          putRecord: async (params: CapturedRecord) => {
            if (fail) throw new Error("putRecord failed");
            records.push(params);
            return { data: {} };
          },
        },
      },
    },
  } as unknown as AtpAgent;
  return { agent, records };
}

function makeWorld(): {
  world: WorldManager;
  npcManager: NpcManager;
  areaManager: AreaManager;
} {
  const npcManager = new NpcManager();
  const questManager = new QuestManager();
  const craftingSystem = new CraftingSystem();
  const areaManager = new AreaManager(npcManager, questManager, craftingSystem);
  const world = {
    areaManager,
    npcManager,
    questManager,
    craftingSystem,
  } as unknown as WorldManager;
  return { world, npcManager, areaManager };
}

describe("WorldPublisher NPC records", () => {
  let silenceLog: ReturnType<typeof spyOn>;

  afterEach(() => {
    silenceLog?.mockRestore();
  });

  test("publishes NPC dialogue trees and merchant shop inventories", async () => {
    silenceLog = spyOn(console, "log").mockImplementation(() => {});
    const { world, npcManager } = makeWorld();
    npcManager.registerDefinition("town:keeper", {
      name: "Web Keeper",
      description: "A merchant.",
      behavior: "merchant",
      dialogue: {
        greeting: { text: "Care to trade?", responses: [{ text: "Yes", next: "shop" }] },
      },
      shop: ["town:silk", "town:gem"],
    });

    const { agent, records } = makeAgent();
    await new WorldPublisher(agent, "did:web:test.server").publishAll(world);

    const npcRecord = records.find((r) => r.collection === NSID.NpcDefinition)?.record;
    expect(npcRecord).toBeDefined();
    expect(npcRecord!.dialogue).toEqual({
      greeting: { text: "Care to trade?", responses: [{ text: "Yes", next: "shop" }] },
    });
    expect(npcRecord!.shop).toEqual(["town:silk", "town:gem"]);
  });
});

const PORTAL_MANIFEST_YML = `title: Border
description: The frontier.
`;

const PORTAL_ROOMS_YML = `- id: gate
  title: The Gate
  description: A shimmering gateway.
  coordinates: { x: 0, y: 0, z: 0 }
  exits:
    - direction: north
      target: did:web:other.example:lobby
      portal: true
`;

describe("WorldPublisher failure accounting", () => {
  let tempDir: string;
  let silenceLog: ReturnType<typeof spyOn>;
  let silenceWarn: ReturnType<typeof spyOn>;

  afterEach(async () => {
    silenceLog?.mockRestore();
    silenceWarn?.mockRestore();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  async function loadPortalWorld(): Promise<WorldManager> {
    tempDir = await mkdtemp(join(tmpdir(), "world-publisher-test-"));
    const areaPath = join(tempDir, "border");
    await mkdir(areaPath);
    await writeFile(join(areaPath, "manifest.yml"), PORTAL_MANIFEST_YML);
    await writeFile(join(areaPath, "rooms.yml"), PORTAL_ROOMS_YML);
    const { world, areaManager } = makeWorld();
    await areaManager.loadFromDirectory(tempDir);
    return world;
  }

  test("counts portals that publish successfully", async () => {
    silenceLog = spyOn(console, "log").mockImplementation(() => {});
    const world = await loadPortalWorld();
    const { agent } = makeAgent();

    const { portalCount } = await new WorldPublisher(agent, "did:web:test.server").publishAll(
      world,
    );
    expect(portalCount).toBe(1);
  });

  test("does not count portals whose publish failed", async () => {
    silenceLog = spyOn(console, "log").mockImplementation(() => {});
    silenceWarn = spyOn(console, "warn").mockImplementation(() => {});
    const world = await loadPortalWorld();
    const { agent } = makeAgent(true);

    const { portalCount } = await new WorldPublisher(agent, "did:web:test.server").publishAll(
      world,
    );
    expect(portalCount).toBe(0);
  });
});
