import type { Direction } from "@realms/lexicons";

export const DIRECTION_ALIASES: Record<string, Direction> = {
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  u: "up",
  d: "down",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
  north: "north",
  south: "south",
  east: "east",
  west: "west",
  up: "up",
  down: "down",
  northeast: "northeast",
  northwest: "northwest",
  southeast: "southeast",
  southwest: "southwest",
};

export const OPPOSITE_DIRECTION: Record<Direction, Direction> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
  up: "down",
  down: "up",
  northeast: "southwest",
  northwest: "southeast",
  southeast: "northwest",
  southwest: "northeast",
};

export function resolveDirection(input: string): Direction | undefined {
  const key = input.toLowerCase();
  // hasOwn so inherited Object.prototype members don't resolve as directions
  return Object.hasOwn(DIRECTION_ALIASES, key) ? DIRECTION_ALIASES[key] : undefined;
}

export function isDirection(input: string): input is Direction {
  return resolveDirection(input) !== undefined;
}
