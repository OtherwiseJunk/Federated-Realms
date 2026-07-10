import { loadConfig } from "./config.js";
import { SqliteSimpleStore } from "./atproto/sqlite-stores.js";
import { AuthTokenStore } from "./atproto/auth-token-store.js";
import { WorldManager } from "./world/world-manager.js";
import { SessionManager } from "./server/session-manager.js";
import { openStateDatabase } from "./server/state-db.js";
import { type SessionData } from "./entities/character-session.js";
import { parseCommand } from "@realms/common";
import { encodeMessage, decodeClientMessage, type ServerMessage } from "@realms/protocol";
import {
  handleCommand,
  sendRoomState,
  sendMapUpdate,
  sendNarrative,
  type CommandContext,
} from "./commands/index.js";
import type { CharacterProfile } from "@realms/lexicons";
import { buildAttributes, computeDerivedStats, xpToNextLevel } from "@realms/common";
import { BlueskyBridge } from "./bluesky/bridge.js";
import { CombatSystem } from "./systems/combat-system.js";
import { ServerIdentity } from "./atproto/server-identity.js";
import { GameOAuthClient } from "./atproto/oauth.js";
import { PdsClient } from "./atproto/pds-client.js";
import { PortalHandler } from "./federation/portal-handler.js";
import { TransferHandler } from "./federation/transfer-handler.js";
import { WorldPublisher } from "./atproto/world-publisher.js";
import { FederationManager } from "./federation/federation-manager.js";
import { ChatRelayService } from "./federation/chat-relay.js";
import { RateLimiter } from "./server/rate-limiter.js";

const config = loadConfig();

// Mutable server state (auth tokens, OAuth sessions) — survives restarts
const stateDb = openStateDatabase(config.dataDir);
const authTokens = new AuthTokenStore(stateDb);
authTokens.purgeExpired();
setInterval(() => authTokens.purgeExpired(), 60 * 60_000); // hourly

// Rate limiters
const authLimiter = new RateLimiter(10, 60_000); // 10 auth attempts per minute per IP
const commandLimiter = new RateLimiter(30, 1_000); // 30 commands per second per session
const MAX_WS_MESSAGE_SIZE = 4096; // 4KB max WebSocket message
const world = new WorldManager(config);
const sessions = new SessionManager();
const bluesky = new BlueskyBridge(config.bluesky);
const serverIdentity = new ServerIdentity();
const oauthClient = new GameOAuthClient();
const pdsClient = new PdsClient(serverIdentity);

const DEV_MODE = process.env.DEV_MODE === "true";

// Pending OAuth logins — maps ticket → result for CLI polling flow
interface PendingLogin {
  status: "pending" | "complete" | "error";
  createdAt: number;
  sessionId?: string;
  websocketUrl?: string;
  did?: string;
  handle?: string;
  authToken?: string;
  needsCharacter?: boolean;
  gameSystem?: unknown;
  error?: string;
}
const pendingLogins = new Map<string, PendingLogin>();

// Clean up stale pending logins every 5 minutes. Window is 15 minutes since
// PDS signup (hCaptcha + email verification) can realistically take longer
// than 5.
setInterval(() => {
  const fifteenMinAgo = Date.now() - 15 * 60_000;
  for (const [ticket, login] of pendingLogins) {
    if (login.createdAt < fifteenMinAgo) pendingLogins.delete(ticket);
  }
}, 5 * 60_000);

let federation: FederationManager | null = null;
let chatRelay: ChatRelayService | null = null;
const portalHandler = new PortalHandler(serverIdentity, pdsClient, config.federation);
const transferHandler = new TransferHandler(
  serverIdentity,
  sessions,
  world,
  config.federation,
  config.atproto,
  config.name,
);

await world.initialize();
await bluesky.initialize();

// Initialize AT Proto player auth in production. Server identity/federation is
// optional and requires SERVER_PASSWORD, but player OAuth does not.
if (!DEV_MODE) {
  try {
    await oauthClient.initialize(config.atproto, {
      stateStore: new SqliteSimpleStore(stateDb, "oauth_state"),
      sessionStore: new SqliteSimpleStore(stateDb, "oauth_session"),
    });
  } catch (err) {
    console.warn(
      "   OAuth initialization failed:",
      err instanceof Error ? (err.stack ?? err.message) : err,
    );
  }

  warnIfPublicUrlLooksLocal(config.atproto.publicUrl);

  if (config.atproto.serverPassword) {
    try {
      await serverIdentity.initialize(config.atproto, config.name, config.description);
      sessions.setServerIdentity(serverIdentity);

      // Publish world data as AT Proto records
      const publisher = new WorldPublisher(serverIdentity.agent, serverIdentity.did);
      const { portalCount } = await publisher.publishAll(world);

      // Federation: publish registration and seed known servers
      federation = new FederationManager(
        serverIdentity,
        config.federation,
        config.atproto,
        config.name,
        config.description,
      );
      await federation.publishRegistration(portalCount, 0);
      await federation.seedFromConfig();
      transferHandler.setFederationManager(federation);

      // Cross-server chat relay
      chatRelay = new ChatRelayService(serverIdentity, federation, sessions);
    } catch (err) {
      console.warn(
        "   Server identity/federation initialization failed:",
        err instanceof Error ? (err.stack ?? err.message) : err,
      );
      console.warn("   Player OAuth may still work; federation features are disabled");
    }
  } else {
    console.warn("   SERVER_PASSWORD not set; server identity and federation are disabled");
  }
}

/** Resolve the caller's DID from a Bearer auth token; null if missing/invalid/expired. */
function bearerDid(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return authTokens.verify(auth.slice("Bearer ".length));
}

function authSuccessHtml(message: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Federated Realms</title>
<style>body{background:#1a1a2e;color:#e0e0e0;font-family:monospace;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
.box{text-align:center;padding:2rem;border:1px solid #4a4a6a;border-radius:8px}h1{color:#7fdbca;margin-bottom:1rem}p{color:#c3c3c3}</style>
</head><body><div class="box"><h1>Federated Realms</h1><p>${message}</p></div></body></html>`;
}

function warnIfPublicUrlLooksLocal(publicUrl: string): void {
  try {
    const parsed = new URL(publicUrl);
    if (["localhost", "127.0.0.1", "0.0.0.0"].includes(parsed.hostname)) {
      console.warn(
        `   PUBLIC_URL is ${publicUrl}; deployed OAuth needs the external HTTPS URL (for example https://mud.cacheblasters.com)`,
      );
    }
  } catch {
    console.warn(`   PUBLIC_URL is not a valid URL: ${publicUrl}`);
  }
}

function broadcast(roomId: string, msg: ServerMessage, excludeSessionId?: string): void {
  const room = world.getRoom(roomId);
  if (!room) return;

  const encoded = encodeMessage(msg);
  for (const playerId of room.getPlayerIds()) {
    if (playerId === excludeSessionId) continue;
    const session = sessions.getSession(playerId);
    session?.send(encoded);
  }
}

const combat = new CombatSystem({ world, sessions, broadcast });

function makeContext(sessionId: string): CommandContext | null {
  const session = sessions.getSession(sessionId);
  if (!session) return null;
  return {
    session,
    world,
    sessions,
    broadcast,
    bluesky,
    combat,
    portalHandler,
    chatRelay: chatRelay ?? undefined,
  };
}

function buildCharacterProfile(
  name: string,
  classId: string = "warrior",
  raceId: string = "human",
): CharacterProfile {
  const system = world.gameSystem;
  const attributes = buildAttributes(system, classId, raceId);
  const derived = computeDerivedStats(system.formulas, 1, attributes);

  return {
    name,
    class: classId,
    race: raceId,
    level: 1,
    experience: 0,
    attributes,
    derived,
    createdAt: new Date().toISOString(),
  };
}

// ── Game Tick Loop ──
// Processes NPC respawns and other periodic game events
const TICK_INTERVAL_MS = 5000; // 5 second tick for respawns

setInterval(() => {
  // Process NPC respawns
  const respawned = world.npcManager.processRespawns((id) => world.getRoom(id));
  for (const npc of respawned) {
    const room = world.getRoom(npc.currentRoom);
    if (room) {
      broadcast(room.id, {
        type: "narrative",
        text: `${npc.name} appears.`,
        style: "info",
      });
    }
  }

  // Process buff/debuff ticks for all players
  for (const session of sessions.getAllSessions()) {
    if (session.state.activeEffects.length === 0) continue;

    const expired = session.tickEffects();
    if (expired.length > 0) {
      const names = expired.join(", ");
      session.send(
        encodeMessage({
          type: "narrative",
          text: `Effect${expired.length > 1 ? "s" : ""} worn off: ${names}`,
          style: "info",
        }),
      );
      // Send updated stats
      const s = session.state;
      session.send(
        encodeMessage({
          type: "character_update",
          hp: s.currentHp,
          maxHp: s.maxHp,
          mp: s.currentMp,
          maxMp: s.maxMp,
          ap: s.currentAp,
          maxAp: s.maxAp,
          gold: s.gold,
          level: s.level,
          xp: s.experience,
          xpToNext: xpToNextLevel(s.level, s.experience),
        }),
      );
    }
  }
}, TICK_INTERVAL_MS);

// ── Periodic Attestation Flush ──
// Flush pending attestation claims for all sessions every 15 minutes
// so accumulated gold/item changes aren't lost to crashes or long sessions.
const ATTESTATION_FLUSH_MS = 15 * 60 * 1000;

setInterval(() => {
  for (const session of sessions.getAllSessions()) {
    session.attestations.flush();
  }
}, ATTESTATION_FLUSH_MS);

// ── Idle Session Cleanup ──
// Disconnect sessions idle for 30+ minutes
setInterval(() => {
  for (const session of sessions.getIdleSessions()) {
    if (session.ws) {
      session.send(
        encodeMessage({
          type: "narrative",
          text: "Disconnected due to inactivity.",
          style: "error",
        }),
      );
      session.ws.close(1000, "Idle timeout");
    }
    sessions.removeSession(session.sessionId);
  }
}, 60_000); // Check every minute

const server = Bun.serve<SessionData>({
  port: config.port,
  hostname: config.host,

  async fetch(req, server) {
    const url = new URL(req.url);

    // ── CORS preflight ──
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // ── WebSocket upgrade ──
    if (url.pathname === "/ws") {
      const sessionId = url.searchParams.get("session");

      if (sessionId && sessions.getSession(sessionId)) {
        const upgraded = server.upgrade(req, { data: { sessionId } });
        if (!upgraded) {
          return new Response("WebSocket upgrade failed", { status: 500 });
        }
        return undefined;
      }

      if (DEV_MODE) {
        // Dev mode: create session on connect with query params
        const name =
          url.searchParams.get("name") ?? `Adventurer_${Math.floor(Math.random() * 9999)}`;
        const classId = url.searchParams.get("class") ?? "warrior";
        const raceId = url.searchParams.get("race") ?? "human";

        const profile = buildCharacterProfile(name, classId, raceId);
        const session = sessions.createSession(
          `dev:${name}`,
          profile,
          world.getDefaultSpawnRoom(),
          world.gameSystem.formulas,
        );

        const upgraded = server.upgrade(req, { data: { sessionId: session.sessionId } });
        if (!upgraded) {
          return new Response("WebSocket upgrade failed", { status: 500 });
        }
        return undefined;
      }

      return new Response(
        "Invalid session. Authenticate via /xrpc/com.cacheblasters.realms.action.connect first.",
        { status: 401 },
      );
    }

    // ── HTTP routes (all get CORS headers) ──
    const httpResponse = await (async (): Promise<Response> => {
      // ── OAuth routes ──

      // OAuth client metadata (served for AT Proto client discovery)
      if (url.pathname === "/oauth/client-metadata.json") {
        return Response.json(oauthClient.getClientMetadata(config.atproto.publicUrl));
      }

      // Start OAuth flow. handle=<user handle> for login, signup=true to
      // register on this server's own PDS (its hosted page handles captcha).
      if (url.pathname === "/auth/login" && req.method === "GET") {
        const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
        if (!authLimiter.check(clientIp)) {
          return Response.json(
            { error: "Too many login attempts. Try again later." },
            { status: 429 },
          );
        }
        const handle = url.searchParams.get("handle");
        const signup = url.searchParams.get("signup") === "true";
        if (!handle && !signup) {
          return Response.json({ error: "handle parameter required" }, { status: 400 });
        }
        if (!oauthClient.initialized) {
          return Response.json(
            {
              error: signup
                ? "Signup is not available on this server"
                : "OAuth is not available on this server",
            },
            { status: 503 },
          );
        }
        try {
          const input = signup ? config.atproto.pdsPublicUrl : handle!;
          const authUrl = await oauthClient.authorize(input);
          // Extract state from auth URL to use as polling ticket
          const ticket = new URL(authUrl).searchParams.get("state") ?? crypto.randomUUID();
          pendingLogins.set(ticket, { status: "pending", createdAt: Date.now() });
          return Response.json({ url: authUrl.toString(), ticket });
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "OAuth failed" },
            { status: 500 },
          );
        }
      }

      // Poll for OAuth result (CLI flow)
      if (url.pathname === "/auth/poll" && req.method === "GET") {
        const ticket = url.searchParams.get("ticket");
        if (!ticket) {
          return Response.json({ error: "ticket parameter required" }, { status: 400 });
        }
        const login = pendingLogins.get(ticket);
        if (!login) {
          return Response.json({ error: "Unknown or expired ticket" }, { status: 404 });
        }
        if (login.status === "pending") {
          return Response.json({ status: "pending" });
        }
        // Return result and clean up
        pendingLogins.delete(ticket);
        if (login.status === "error") {
          return Response.json({ status: "error", error: login.error }, { status: 500 });
        }
        return Response.json({
          status: "complete",
          sessionId: login.sessionId,
          websocketUrl: login.websocketUrl,
          did: login.did,
          handle: login.handle,
          authToken: login.authToken,
          needsCharacter: login.needsCharacter,
          gameSystem: login.gameSystem,
        });
      }

      // OAuth callback
      if (url.pathname === "/oauth/callback") {
        const stateParam = url.searchParams.get("state") ?? "";
        try {
          const { session: oauthSession, agent } = await oauthClient.callback(url.searchParams);
          const did = oauthSession.did;
          const authToken = authTokens.issue(did);

          // Resolve the account's handle so the client can display/store it
          // instead of a raw DID (e.g. right after PDS-hosted signup).
          let handle: string | undefined;
          try {
            const res = await agent.com.atproto.server.getSession(
              {},
              { signal: AbortSignal.timeout(5000) },
            );
            handle = res.data.handle;
          } catch {
            // handle stays undefined — client falls back to prior/DID
          }

          // Check if player has a character on this server
          const existingProfile = await pdsClient.loadCharacter(agent, did);
          if (existingProfile) {
            // Returning player — create game session
            const gameSession = sessions.createSession(
              did,
              existingProfile,
              world.getDefaultSpawnRoom(),
              world.gameSystem.formulas,
            );
            const result = {
              sessionId: gameSession.sessionId,
              websocketUrl: `${config.atproto.publicUrl.replace(/^http/, "ws")}/ws?session=${gameSession.sessionId}`,
              spawnRoom: gameSession.currentRoom,
              characterState: gameSession.state,
              handle,
              authToken,
            };

            // If this came from a CLI polling flow, store result
            if (pendingLogins.has(stateParam)) {
              pendingLogins.set(stateParam, {
                status: "complete",
                createdAt: Date.now(),
                sessionId: result.sessionId,
                websocketUrl: result.websocketUrl,
                did,
                handle,
                authToken,
              });
              return new Response(
                authSuccessHtml("Authorization successful! You can return to your terminal."),
                {
                  headers: { "Content-Type": "text/html" },
                },
              );
            }

            return Response.json(result);
          }

          // New player — needs character creation
          if (pendingLogins.has(stateParam)) {
            pendingLogins.set(stateParam, {
              status: "complete",
              createdAt: Date.now(),
              did,
              handle,
              authToken,
              needsCharacter: true,
              gameSystem: world.gameSystem,
            });
            return new Response(
              authSuccessHtml(
                "Authorization successful! Return to your terminal to create your character.",
              ),
              {
                headers: { "Content-Type": "text/html" },
              },
            );
          }

          return Response.json({
            needsCharacter: true,
            did,
            handle,
            authToken,
            gameSystem: world.gameSystem,
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Callback failed";
          if (pendingLogins.has(stateParam)) {
            pendingLogins.set(stateParam, {
              status: "error",
              createdAt: Date.now(),
              error: errorMsg,
            });
            return new Response(
              authSuccessHtml("Authentication failed. Return to your terminal."),
              {
                headers: { "Content-Type": "text/html" },
              },
            );
          }
          return Response.json({ error: errorMsg }, { status: 500 });
        }
      }

      // ── XRPC endpoints ──

      // Connect: authenticate and load or prompt character creation
      if (
        url.pathname === "/xrpc/com.cacheblasters.realms.action.connect" &&
        req.method === "POST"
      ) {
        try {
          const did = bearerDid(req);
          if (!did) {
            return Response.json(
              { error: "Authentication required. Complete OAuth login first." },
              { status: 401 },
            );
          }

          const agent = await oauthClient.restore(did);
          if (!agent) {
            return Response.json(
              { error: "No valid session. Please authenticate first." },
              { status: 401 },
            );
          }

          const profile = await pdsClient.loadCharacter(agent, did);
          if (profile) {
            const gameSession = sessions.createSession(
              did,
              profile,
              world.getDefaultSpawnRoom(),
              world.gameSystem.formulas,
            );
            return Response.json({
              sessionId: gameSession.sessionId,
              websocketUrl: `${config.atproto.publicUrl.replace(/^http/, "ws")}/ws?session=${gameSession.sessionId}`,
              spawnRoom: gameSession.currentRoom,
              characterState: gameSession.state,
            });
          }

          // New player
          return Response.json({
            needsCharacter: true,
            gameSystem: world.gameSystem,
          });
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "Connect failed" },
            { status: 500 },
          );
        }
      }

      // Create character: build a new character and write to PDS
      if (
        url.pathname === "/xrpc/com.cacheblasters.realms.action.createCharacter" &&
        req.method === "POST"
      ) {
        try {
          const did = bearerDid(req);
          if (!did) {
            return Response.json(
              { error: "Authentication required. Complete OAuth login first." },
              { status: 401 },
            );
          }

          const body = (await req.json()) as {
            name: string;
            classId: string;
            raceId: string;
          };
          if (!body.name || !body.classId || !body.raceId) {
            return Response.json(
              { error: "name, classId, and raceId are required" },
              { status: 400 },
            );
          }
          if (body.name.length > 32 || body.classId.length > 64 || body.raceId.length > 64) {
            return Response.json(
              { error: "Field length exceeds maximum allowed" },
              { status: 400 },
            );
          }

          const agent = await oauthClient.restore(did);
          if (!agent) {
            return Response.json(
              { error: "No valid session. Please authenticate first." },
              { status: 401 },
            );
          }

          // Build character profile using this server's game system
          const profile = buildCharacterProfile(body.name, body.classId, body.raceId);

          // Write to player's PDS
          await pdsClient.saveCharacter(agent, did, profile);

          // Create game session
          const gameSession = sessions.createSession(
            did,
            profile,
            world.getDefaultSpawnRoom(),
            world.gameSystem.formulas,
          );
          return Response.json({
            sessionId: gameSession.sessionId,
            websocketUrl: `${config.atproto.publicUrl.replace(/^http/, "ws")}/ws?session=${gameSession.sessionId}`,
            spawnRoom: gameSession.currentRoom,
            characterState: gameSession.state,
          });
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "Character creation failed" },
            { status: 500 },
          );
        }
      }

      // Federation: receive character transfer from another server
      if (
        url.pathname === "/xrpc/com.cacheblasters.realms.federation.transfer" &&
        req.method === "POST"
      ) {
        try {
          const body = (await req.json()) as {
            token: string;
            character: Record<string, unknown>;
            attestations?: unknown[];
          };
          if (!body.token || !body.character) {
            return Response.json({ error: "token and character are required" }, { status: 400 });
          }
          const result = await transferHandler.handleTransfer(body);
          return Response.json(result);
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "Transfer failed" },
            { status: 500 },
          );
        }
      }

      // Chat relay: receive a tell message from another federated server
      if (url.pathname === "/xrpc/com.cacheblasters.realms.chat.relay" && req.method === "POST") {
        try {
          const body = (await req.json()) as {
            senderName: string;
            senderDid: string;
            recipientName: string;
            message: string;
            sourceServer: string;
          };
          if (!body.senderName || !body.recipientName || !body.message || !body.sourceServer) {
            return Response.json({ delivered: false, reason: "Missing fields" }, { status: 400 });
          }
          // Validate message length
          if (body.message.length > 1000 || body.senderName.length > 100) {
            return Response.json({ delivered: false, reason: "Message too long" }, { status: 400 });
          }
          // Verify source server is a known federated server
          if (federation) {
            const known = await federation.resolveServer(body.sourceServer);
            if (!known) {
              return Response.json(
                { delivered: false, reason: "Unknown source server" },
                { status: 403 },
              );
            }
          }
          const target = sessions.findByName(body.recipientName);
          if (!target) {
            return Response.json({ delivered: false, reason: "Player not online" });
          }
          target.send(
            encodeMessage({
              type: "chat",
              channel: "tell",
              sender: body.senderName,
              message: body.message,
            }),
          );
          return Response.json({ delivered: true });
        } catch {
          return Response.json({ delivered: false, reason: "Internal error" }, { status: 500 });
        }
      }

      // Chat locate: check if a player is online on this server
      if (
        url.pathname === "/xrpc/com.cacheblasters.realms.chat.locatePlayer" &&
        req.method === "GET"
      ) {
        const name = url.searchParams.get("name");
        if (!name || name.length > 100) {
          return Response.json({ found: false });
        }
        const target = sessions.findByName(name);
        if (target) {
          return Response.json({ found: true, playerDid: target.characterDid });
        }
        return Response.json({ found: false });
      }

      // ── Info routes ──

      // Health check
      if (url.pathname === "/health") {
        return Response.json({
          status: "ok",
          server: config.name,
          players: sessions.getOnlineCount(),
          serverDid: serverIdentity.did || undefined,
        });
      }

      // Server info
      if (url.pathname === "/info") {
        // PDS uses .test as handle domain when hostname is localhost
        const handleDomain =
          config.atproto.pdsHostname === "localhost" ? "test" : config.atproto.pdsHostname;
        return Response.json({
          name: config.name,
          description: config.description,
          players: sessions.getOnlineCount(),
          rooms: world.areaManager.getAllRooms().size,
          serverDid: serverIdentity.did || undefined,
          pdsHostname: handleDomain,
          signup: { available: oauthClient.initialized },
        });
      }

      // Game system schema
      if (url.pathname === "/system") {
        return Response.json(world.gameSystem);
      }

      return new Response("Federated Realms Server", { status: 200 });
    })();
    httpResponse.headers.set("Access-Control-Allow-Origin", "*");
    httpResponse.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    httpResponse.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return httpResponse;
  },

  websocket: {
    open(ws: import("bun").ServerWebSocket<SessionData>) {
      const session = sessions.attachWebSocket(ws.data.sessionId, ws);
      if (!session) {
        ws.close(4001, "Invalid session");
        return;
      }

      console.log(`Player connected: ${session.name} (${session.sessionId})`);

      // Place player in spawn room
      const spawnRoom = world.getRoom(session.currentRoom);
      if (spawnRoom) {
        spawnRoom.addPlayer(session.sessionId, session.name);

        // Notify room
        broadcast(
          spawnRoom.id,
          {
            type: "entity_enter",
            entity: { id: session.sessionId, name: session.name, type: "player" },
            room: spawnRoom.id,
          },
          session.sessionId,
        );
      }

      // Send welcome
      session.send(
        encodeMessage({
          type: "welcome",
          sessionId: session.sessionId,
          serverName: config.name,
        }),
      );

      // Post to Bluesky
      bluesky.post({
        type: "system",
        roomId: session.currentRoom,
        roomTitle: spawnRoom?.title ?? session.currentRoom,
        playerName: session.name,
        playerDid: session.characterDid,
        text: `${session.name} has entered the realm.`,
      });

      // Send initial character stats + inventory
      const s = session.state;
      session.send(
        encodeMessage({
          type: "character_update",
          hp: s.currentHp,
          maxHp: s.maxHp,
          mp: s.currentMp,
          maxMp: s.maxMp,
          ap: s.currentAp,
          maxAp: s.maxAp,
          gold: s.gold,
          level: s.level,
          xp: s.experience,
          xpToNext: xpToNextLevel(s.level, s.experience),
        }),
      );
      session.send(
        encodeMessage({
          type: "inventory_update",
          inventory: s.inventory,
        }),
      );
      session.send(
        encodeMessage({
          type: "equipment_update",
          equipment: s.equipment,
        }),
      );

      // Send quest log
      const questLog = world.questManager.buildLogPayload(session.characterDid);
      session.send(encodeMessage(questLog));

      // Send initial room state and map
      const ctx = makeContext(session.sessionId);
      if (ctx) {
        sendRoomState(session, ctx);
        sendMapUpdate(session, ctx);
      }

      // Deliver pending offline messages
      if (chatRelay) {
        chatRelay.deliverPendingMessages(session).catch((err) => {
          console.warn(
            `   Failed to deliver mailbox for ${session.name}:`,
            err instanceof Error ? err.message : err,
          );
        });
      }

      // Check for pending portal adaptation (foreign class/race)
      const adaptation = transferHandler.buildAdaptationMessage(session.sessionId);
      if (adaptation) {
        const parts: string[] = [];
        if (adaptation.class) parts.push(`class "${adaptation.class.original}"`);
        if (adaptation.race) parts.push(`race "${adaptation.race.original}"`);
        session.send(
          encodeMessage({
            type: "adaptation_required",
            adaptation,
            message: `This realm doesn't recognize your ${parts.join(" or ")}. Please choose a local equivalent.`,
          }),
        );
      }
    },

    message(ws: import("bun").ServerWebSocket<SessionData>, message: string | Buffer) {
      const data = typeof message === "string" ? message : message.toString();

      // Reject oversized messages
      if (data.length > MAX_WS_MESSAGE_SIZE) return;

      // Rate limit commands per session
      if (!commandLimiter.check(ws.data.sessionId)) return;

      // Track activity for idle timeout
      sessions.touch(ws.data.sessionId);

      const clientMsg = decodeClientMessage(data);

      if (!clientMsg) return;

      const ctx = makeContext(ws.data.sessionId);
      if (!ctx) return;

      switch (clientMsg.type) {
        case "command": {
          const parsed = parseCommand(`${clientMsg.command} ${clientMsg.args.join(" ")}`.trim());
          handleCommand(parsed, ctx);
          ctx.session.send(encodeMessage({ type: "ack", id: clientMsg.id }));
          break;
        }

        case "move": {
          const parsed = parseCommand(`go ${clientMsg.direction}`);
          handleCommand(parsed, ctx);
          ctx.session.send(encodeMessage({ type: "ack", id: clientMsg.id }));
          break;
        }

        case "chat": {
          const verb = clientMsg.channel === "shout" ? "shout" : "say";
          const parsed = parseCommand(`${verb} ${clientMsg.message}`);
          handleCommand(parsed, ctx);
          break;
        }

        case "adaptation_response": {
          const applied = transferHandler.applyAdaptation(
            ws.data.sessionId,
            clientMsg.classId,
            clientMsg.raceId,
          );
          if (applied) {
            // Resend character state with updated class/race/stats
            const s = ctx.session.state;
            ctx.session.send(
              encodeMessage({
                type: "character_update",
                hp: s.currentHp,
                maxHp: s.maxHp,
                mp: s.currentMp,
                maxMp: s.maxMp,
                ap: s.currentAp,
                maxAp: s.maxAp,
                gold: s.gold,
                level: s.level,
                xp: s.experience,
                xpToNext: xpToNextLevel(s.level, s.experience),
              }),
            );
            sendNarrative(
              ctx.session,
              `Your form shifts to match this realm. You are now a ${s.race} ${s.class}.`,
              "system",
            );
          }
          break;
        }

        case "ping": {
          ctx.session.send(encodeMessage({ type: "pong", serverTime: Date.now() }));
          break;
        }
      }
    },

    close(ws: import("bun").ServerWebSocket<SessionData>) {
      const session = sessions.getSession(ws.data.sessionId);
      if (!session) return;

      console.log(`Player disconnected: ${session.name}`);

      // End combat if in combat — reset ALL combat NPCs, not just the target
      if (session.inCombat) {
        combat.disengageAll(session);
      }

      // Remove from room
      const room = world.getRoom(session.currentRoom);
      if (room) {
        const entity = room.removePlayer(session.sessionId);
        if (entity) {
          broadcast(room.id, {
            type: "entity_leave",
            entity,
            room: room.id,
          });
        }
      }

      // Post to Bluesky
      bluesky.post({
        type: "system",
        roomId: session.currentRoom,
        roomTitle: room?.title ?? session.currentRoom,
        playerName: session.name,
        playerDid: session.characterDid,
        text: `${session.name} has left the realm.`,
      });

      // Finalize attestations and store in character profile extensions
      session.attestations
        .finalize()
        .then((attestations) => {
          if (attestations.length > 0) {
            const s = session.state;
            const serverExt =
              (s.extensions?.[serverIdentity.did] as { attestations?: unknown[] } | undefined) ??
              {};
            const existing = serverExt.attestations ?? [];
            s.extensions = {
              ...s.extensions,
              [serverIdentity.did]: {
                ...serverExt,
                attestations: [...existing, ...attestations],
              },
            };
          }
        })
        .catch((err) => {
          console.warn(
            `Failed to finalize attestations for ${session.name}:`,
            err instanceof Error ? err.message : err,
          );
        });

      transferHandler.pendingAdaptations.delete(session.sessionId);
      sessions.removeSession(session.sessionId);
    },
  },
});

console.log(`\n⚔️  ${config.name}`);
console.log(`   Listening on ${server.hostname}:${server.port}`);
console.log(`   WebSocket: ws://${server.hostname}:${server.port}/ws`);
console.log(`   Health: http://${server.hostname}:${server.port}/health`);
if (DEV_MODE) {
  console.log(`   Mode: DEV (no auth required)`);
} else {
  if (serverIdentity.did) {
    console.log(`   Server DID: ${serverIdentity.did}`);
  }
  console.log(
    `   OAuth: ${
      oauthClient.initialized
        ? `${config.atproto.publicUrl}/oauth/client-metadata.json`
        : "disabled"
    }`,
  );
}
console.log();
