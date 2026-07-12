import { resolveDirection } from "../utils/direction.js";

export interface ParsedCommand {
  verb: string;
  args: string[];
  target?: string;
  raw: string;
}

const ALIASES: Record<string, string> = {
  l: "look",
  i: "inventory",
  inv: "inventory",
  eq: "equipment",
  ex: "examine",
  get: "take",
  pickup: "take",
  k: "kill",
  hit: "attack",
  fight: "attack",
  def: "defend",
  block: "defend",
  run: "flee",
  escape: "flee",
  drink: "use",
  quaff: "use",
  c: "cast",
  wear: "equip",
  wield: "equip",
  m: "map",
  j: "log",
  b: "buy",
  purchase: "buy",
  msg: "tell",
  message: "tell",
  pm: "tell",
  "?": "help",
  quit: "disconnect",
  exit: "disconnect",
};

// Direction shortcuts that map to "go <direction>"
const DIRECTION_VERBS = new Set([
  "n",
  "s",
  "e",
  "w",
  "u",
  "d",
  "ne",
  "nw",
  "se",
  "sw",
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
]);

// We parse the command into a standard structure, but we don't enforce strict verb/arg patterns here.
// The game logic will interpret the verb and args as needed, allowing servers to define their own
// command sets and parsing rules on top of this basic structure.
export function parseCommand(input: string): ParsedCommand {
  const raw = input.trim();
  if (!raw) {
    return { verb: "", args: [], raw };
  }

  // Split input into verb and args by whitespace
  const parts = raw.split(/\s+/);
  let verb = parts[0].toLowerCase();
  let args = parts.slice(1);

  // Handle direction shortcuts: "n" -> "go north"
  if (DIRECTION_VERBS.has(verb)) {
    const dir = resolveDirection(verb);
    if (dir) {
      return { verb: "go", args: [dir], target: dir, raw };
    }
  }

  // Handle "go <direction>"
  if (verb === "go" && args.length > 0) {
    const dir = resolveDirection(args[0]);
    if (dir) {
      return { verb: "go", args: [dir], target: dir, raw };
    }
  }

  // Apply aliases (hasOwn so inherited Object.prototype members don't resolve)
  if (Object.hasOwn(ALIASES, verb)) {
    verb = ALIASES[verb];
  }

  // Extract target (first arg for most commands)
  const target = args.length > 0 ? args.join(" ") : undefined;

  return { verb, args, target, raw };
}

export function getCommandHelp(): string[] {
  return [
    "Movement: north/n, south/s, east/e, west/w, up/u, down/d, ne, nw, se, sw",
    "Looking:  look/l, examine/ex <target>",
    "Items:    take/get <item>, drop <item>, inventory/i, use/drink <item>",
    "Quests:   quests, log, accept <quest>, abandon <quest>, turnin",
    "Trade:    shop, buy <item>, sell <item>",
    "Craft:    recipes, craft <recipe>, gather [node]",
    "Equip:    equip/wield <item>, unequip/remove <item>, equipment/eq",
    "Combat:   attack/kill <target> (2 AP), defend (1 AP), flee/retreat (3 AP)",
    "Spells:   cast <spell> [target], spells   Items in combat: use <item> (2 AP)",
    "NPCs:     talk <npc> [topic], look <npc>",
    "Social:   say <msg>, shout <msg>, whisper <player> <msg>, tell/msg <player> <msg>",
    "Info:     who, stats, map/m, help/?",
    "System:   disconnect/quit",
  ];
}
