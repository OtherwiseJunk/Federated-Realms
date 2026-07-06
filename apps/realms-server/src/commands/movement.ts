import type { ParsedCommand } from "@realms/common";
import { resolveDirection } from "@realms/common";
import type { CommandContext } from "./index.js";
import { sendNarrative, sendRoomState, sendMapUpdate } from "./index.js";

export function handleMovement(cmd: ParsedCommand, ctx: CommandContext): void {
  const { session, world, broadcast } = ctx;
  const dirStr = cmd.args[0];

  if (!dirStr) {
    sendNarrative(session, "Go where? Specify a direction.", "error");
    return;
  }

  const direction = resolveDirection(dirStr);
  if (!direction) {
    sendNarrative(session, `'${dirStr}' is not a valid direction.`, "error");
    return;
  }

  const currentRoom = world.getRoom(session.currentRoom);
  if (!currentRoom) {
    sendNarrative(session, "You seem to be lost in a void.", "error");
    return;
  }

  const exit = currentRoom.getExit(direction);
  if (!exit) {
    sendNarrative(session, `There is no exit to the ${direction}.`, "error");
    return;
  }

  if (exit.requiredLevel && session.state.level < exit.requiredLevel) {
    sendNarrative(
      session,
      `You must be at least level ${exit.requiredLevel} to go that way.`,
      "error",
    );
    return;
  }

  // Portal exit — hand off to federation portal handler
  if (exit.portal && ctx.portalHandler) {
    ctx.portalHandler.traverse(session, exit, (text, style) => {
      sendNarrative(session, text, (style as "info" | "error" | "system") ?? "info");
    });
    return;
  }

  const targetRoom = world.getRoom(exit.target);
  if (!targetRoom) {
    sendNarrative(session, "That exit leads somewhere that doesn't exist yet.", "error");
    return;
  }

  // Remove from current room
  const playerEntity = currentRoom.removePlayer(session.sessionId);
  if (playerEntity) {
    broadcast(
      currentRoom.id,
      { type: "entity_leave", entity: playerEntity, room: currentRoom.id, direction },
      session.sessionId,
    );
  }

  // Move to new room
  session.currentRoom = targetRoom.id;
  session.visitedRooms.add(targetRoom.id);
  targetRoom.addPlayer(session.sessionId, session.name);

  // Notify new room
  broadcast(
    targetRoom.id,
    {
      type: "entity_enter",
      entity: { id: session.sessionId, name: session.name, type: "player" },
      room: targetRoom.id,
    },
    session.sessionId,
  );

  // Send room state and map update to the moving player
  sendRoomState(session, ctx);
  sendMapUpdate(session, ctx);

  // Auto-aggro: hostile NPCs in the room attack the player
  if (!targetRoom.isSafe()) {
    const hostiles = world.npcManager
      .getAllInRoom(targetRoom.id)
      .filter((npc) => npc.behavior === "hostile" && npc.state === "idle");
    if (hostiles.length > 0) {
      const aggressor = hostiles[0];
      ctx.combat.npcAggro(session, aggressor);
    }
  }

  // Post movement to Bluesky
  ctx.bluesky.post({
    type: "movement",
    roomId: targetRoom.id,
    roomTitle: targetRoom.title,
    playerName: session.name,
    playerDid: session.characterDid,
    text: `${session.name} arrived at ${targetRoom.title}.`,
  });
}
