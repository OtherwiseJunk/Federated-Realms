import type { CharacterSession } from "../entities/character-session.js";
import type { WorldManager } from "../world/world-manager.js";
import type { ServerIdentity } from "../atproto/server-identity.js";

export interface ServerHooks {
  /** Called after world data is loaded, before server starts listening */
  onWorldLoaded?(world: WorldManager): void | Promise<void>;

  /** Called after AT Proto services initialize */
  onAtProtoReady?(identity: ServerIdentity): void | Promise<void>;

  /** Called when a player connects (after session creation, before room placement) */
  onPlayerConnect?(session: CharacterSession): void | Promise<void>;

  /** Called when a player disconnects */
  onPlayerDisconnect?(session: CharacterSession): void | Promise<void>;

  /** Called each game tick */
  onTick?(deltaMs: number): void | Promise<void>;

  /** Called when a character transfers in via portal */
  onTransferIn?(session: CharacterSession, sourceServerDid: string): void | Promise<void>;

  /** Called when a character transfers out via portal */
  onTransferOut?(session: CharacterSession, targetServerDid: string): void | Promise<void>;
}
