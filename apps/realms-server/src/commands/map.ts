import type { CommandContext } from "./index.js";
import { sendNarrative } from "./index.js";
import type { CharacterSession, WorldManager } from "@realms/server-sdk";

interface MapRoom {
  id: string;
  title: string;
  x: number;
  y: number;
  z: number;
  exits: Array<{ direction: string; target: string }>;
  isCurrent: boolean;
}

export interface MapData {
  /** Each row of the grid as a string */
  grid: string[];
  /** Row index of the player's [@] marker */
  cursorRow: number;
  /** Column index of the center of the player's [@] marker */
  cursorCol: number;
  /** Room name legend entries */
  legend: string[];
}

const DIR_DELTA: Record<string, [number, number]> = {
  north: [0, 1],
  south: [0, -1],
  east: [1, 0],
  west: [-1, 0],
  northeast: [1, 1],
  northwest: [-1, 1],
  southeast: [1, -1],
  southwest: [-1, -1],
};

const DIR_CHAR: Record<string, string> = {
  north: "|",
  south: "|",
  east: "-",
  west: "-",
  northeast: "/",
  northwest: "\\",
  southeast: "\\",
  southwest: "/",
};

/** Generate map data for a session (reusable by command and movement) */
export function generateMapData(session: CharacterSession, world: WorldManager): MapData | null {
  const currentRoom = world.getRoom(session.currentRoom);
  if (!currentRoom) return null;

  const currentZ = currentRoom.coordinates.z;

  const mapRooms: MapRoom[] = [];
  for (const roomId of session.visitedRooms) {
    const room = world.getRoom(roomId);
    if (!room) continue;
    mapRooms.push({
      id: room.id,
      title: room.title,
      x: room.coordinates.x,
      y: room.coordinates.y,
      z: room.coordinates.z,
      exits: room.exits.map((e) => ({ direction: e.direction, target: e.target })),
      isCurrent: room.id === session.currentRoom,
    });
  }

  const onLevel = mapRooms.filter((r) => r.z === currentZ);
  if (onLevel.length === 0) return null;

  return renderMap(onLevel, currentZ);
}

/** Handle the 'map' command — sends full map as narrative */
export function handleMap(ctx: CommandContext): void {
  const data = generateMapData(ctx.session, ctx.world);
  if (!data) {
    sendNarrative(ctx.session, "You haven't explored enough to draw a map yet.", "info");
    return;
  }

  const lines = ["Map", "", ...data.grid, "", "[@] You are here   [+] Visited", ...data.legend];
  sendNarrative(ctx.session, lines.join("\n"), "system");
}

function renderMap(rooms: MapRoom[], _z: number): MapData {
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;
  for (const r of rooms) {
    minX = Math.min(minX, r.x);
    maxX = Math.max(maxX, r.x);
    minY = Math.min(minY, r.y);
    maxY = Math.max(maxY, r.y);
  }

  const gridW = (maxX - minX) * 4 + 3;
  const gridH = (maxY - minY) * 2 + 1;

  const grid: string[][] = [];
  for (let row = 0; row < gridH; row++) {
    grid.push(Array.from({ length: gridW }, () => " "));
  }

  const roomAt = new Map<string, MapRoom>();
  for (const r of rooms) {
    roomAt.set(`${r.x},${r.y}`, r);
  }

  let cursorRow = 0;
  let cursorCol = 0;

  for (const r of rooms) {
    const col = (r.x - minX) * 4;
    const row = (maxY - r.y) * 2;

    const symbol = r.isCurrent ? "[@]" : "[+]";
    grid[row][col] = symbol[0];
    grid[row][col + 1] = symbol[1];
    grid[row][col + 2] = symbol[2];

    if (r.isCurrent) {
      cursorRow = row;
      cursorCol = col + 1; // center of [@]
    }

    for (const exit of r.exits) {
      const delta = DIR_DELTA[exit.direction];
      if (!delta) continue;

      const [dx, dy] = delta;
      const neighborKey = `${r.x + dx},${r.y + dy}`;
      if (!roomAt.has(neighborKey)) continue;

      const char = DIR_CHAR[exit.direction] ?? "-";

      if (exit.direction === "east" || exit.direction === "west") {
        const connCol = exit.direction === "east" ? col + 3 : col - 1;
        if (connCol >= 0 && connCol < gridW) {
          grid[row][connCol] = char;
        }
      } else if (exit.direction === "north" || exit.direction === "south") {
        const connRow = exit.direction === "north" ? row - 1 : row + 1;
        if (connRow >= 0 && connRow < gridH) {
          grid[connRow][col + 1] = char;
        }
      } else {
        const connCol = col + 1 + dx * 2;
        const connRow = row - dy;
        if (connRow >= 0 && connRow < gridH && connCol >= 0 && connCol < gridW) {
          grid[connRow][connCol] = char;
        }
      }
    }
  }

  // Convert grid to string rows, trim trailing whitespace
  const gridLines = grid.map((row) => row.join("").replace(/\s+$/, ""));

  // Build legend
  const legend: string[] = [];
  const currentRoom = rooms.find((r) => r.isCurrent);
  if (currentRoom) {
    const vertExits = currentRoom.exits
      .filter((e) => e.direction === "up" || e.direction === "down")
      .map((e) => e.direction);
    if (vertExits.length > 0) {
      legend.push(`Exits: ${vertExits.join(", ")} (other level)`);
    }
  }
  for (const r of rooms) {
    const marker = r.isCurrent ? "@" : "+";
    legend.push(`  ${marker} ${r.title}`);
  }

  return { grid: gridLines, cursorRow, cursorCol, legend };
}
