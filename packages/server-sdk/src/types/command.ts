import type { ParsedCommand } from "@realms/common";
import type { CharacterSession } from "../entities/character-session.js";
import type { WorldManager } from "../world/world-manager.js";
import type { SessionManager } from "../server/session-manager.js";
import type { BlueskyBridge } from "../integrations/bluesky-bridge.js";
import type { CombatSystem } from "../systems/combat-system.js";
import type { PortalHandler } from "../federation/portal-handler.js";
import type { ChatRelayService } from "../federation/chat-relay.js";
import type { ServerMessage } from "@realms/protocol";

export interface CommandContext {
  session: CharacterSession;
  world: WorldManager;
  sessions: SessionManager;
  broadcast: (roomId: string, msg: ServerMessage, excludeSessionId?: string) => void;
  bluesky: BlueskyBridge;
  combat: CombatSystem;
  portalHandler?: PortalHandler;
  chatRelay?: ChatRelayService;
}

export interface CommandHandler {
  /** The verb(s) this handler responds to */
  verbs: string[];

  /** Human-readable help text */
  help?: string;

  /** Whether this command is allowed during combat */
  allowInCombat?: boolean;

  /** Execute the command */
  execute(cmd: ParsedCommand, ctx: CommandContext): void | Promise<void>;
}

export interface CommandRegistry {
  /** Register a custom command handler */
  register(handler: CommandHandler): void;

  /** Remove a handler by verb */
  unregister(verb: string): void;

  /** Override a built-in command */
  override(verb: string, handler: CommandHandler): void;

  /** Get all registered handlers */
  getAll(): CommandHandler[];

  /** Dispatch a parsed command to the appropriate handler */
  dispatch(cmd: ParsedCommand, ctx: CommandContext): void | Promise<void>;
}
