/// Simple interactive test client for the realms server
/// Usage: bun apps/realms-server/src/test-client.ts [name] [port]

import { parseCommand } from "@realms/common";
import { encodeMessage, decodeServerMessage, type ClientMessage } from "@realms/protocol";
import * as fmt from "@realms/common";
import * as readline from "node:readline";

const name = process.argv[2] ?? "TestHero";
const port = process.argv[3] ?? "3333";
const url = `ws://localhost:${port}/ws?name=${encodeURIComponent(name)}&class=warrior&race=human`;

console.log(fmt.system(`Connecting to ${url}...`));

const ws = new WebSocket(url);
let cmdId = 0;
let ready = false;
const pendingCommands: string[] = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "> ",
});

ws.onopen = () => {
  console.log(fmt.system("Connected!"));
  ready = true;
  // Flush any commands that arrived before connection, with small delays
  if (pendingCommands.length > 0) {
    const flush = async () => {
      for (const cmd of pendingCommands) {
        await new Promise((r) => setTimeout(r, 150));
        sendCommand(cmd);
      }
      pendingCommands.length = 0;
      if (stdinClosed) {
        await new Promise((r) => setTimeout(r, 500));
        ws.close();
      }
    };
    flush();
  }
  rl.prompt();
};

ws.onmessage = (event) => {
  const msg = decodeServerMessage(
    typeof event.data === "string" ? event.data : event.data.toString(),
  );
  if (!msg) return;

  switch (msg.type) {
    case "welcome":
      console.log(fmt.system(`\nWelcome to ${msg.serverName}! (session: ${msg.sessionId})\n`));
      break;

    case "room_state": {
      const r = msg.room;
      console.log("");
      console.log(fmt.roomTitle(r.title));
      console.log(fmt.narrative(r.description));

      if (r.players.length > 0) {
        const others = r.players.filter((p) => p.name !== name);
        if (others.length > 0) {
          console.log(
            fmt.dim(`Players here: ${others.map((p) => fmt.playerName(p.name)).join(", ")}`),
          );
        }
      }
      if (r.npcs.length > 0) {
        console.log(fmt.dim(`NPCs: ${r.npcs.map((n) => fmt.npcName(n.name)).join(", ")}`));
      }
      if (r.items.length > 0) {
        const itemNames = r.items.map((i) => {
          const qty = i.quantity > 1 ? ` (x${i.quantity})` : "";
          return `${i.name}${qty}`;
        });
        console.log(fmt.dim(`Items: ${itemNames.join(", ")}`));
      }
      if (r.flags.length > 0) {
        console.log(fmt.dim(`[${r.flags.join(", ")}]`));
      }
      console.log(fmt.exitList(r.exits.map((e) => e.direction)));
      console.log("");
      rl.prompt();
      break;
    }

    case "narrative":
      console.log(
        msg.style === "error"
          ? fmt.error(msg.text)
          : msg.style === "system"
            ? fmt.system(msg.text)
            : fmt.narrative(msg.text),
      );
      rl.prompt();
      break;

    case "entity_enter":
      console.log(fmt.system(`${msg.entity.name} has arrived.`));
      rl.prompt();
      break;

    case "entity_leave":
      console.log(
        fmt.system(`${msg.entity.name} left${msg.direction ? ` to the ${msg.direction}` : ""}.`),
      );
      rl.prompt();
      break;

    case "chat":
      if (msg.channel === "whisper") {
        console.log(fmt.color(`${msg.sender} whispers: ${msg.message}`, "magenta"));
      } else if (msg.channel === "shout") {
        console.log(fmt.color(`${msg.sender} shouts: ${msg.message}`, "red"));
      } else {
        console.log(`${fmt.playerName(msg.sender)} says: ${msg.message}`);
      }
      rl.prompt();
      break;

    case "error":
      console.log(fmt.error(`[${msg.code}] ${msg.message}`));
      rl.prompt();
      break;

    case "ack":
      break;

    case "inventory_update":
      console.log(fmt.dim(`[Inventory updated: ${msg.inventory.length} item(s)]`));
      rl.prompt();
      break;

    case "pong":
      console.log(fmt.dim(`pong (server time: ${msg.serverTime})`));
      rl.prompt();
      break;
  }
};

ws.onclose = () => {
  console.log(fmt.system("\nDisconnected from server."));
  process.exit(0);
};

ws.onerror = (err) => {
  console.error(fmt.error(`WebSocket error: ${err}`));
};

function sendCommand(input: string): void {
  if (input === "quit" || input === "disconnect") {
    ws.close();
    return;
  }

  const parsed = parseCommand(input);
  const id = String(++cmdId);

  const msg: ClientMessage = {
    type: "command",
    id,
    command: parsed.verb,
    args: parsed.args,
  };

  ws.send(encodeMessage(msg));
}

rl.on("line", (input) => {
  const trimmed = input.trim();
  if (!trimmed) {
    rl.prompt();
    return;
  }

  if (!ready) {
    pendingCommands.push(trimmed);
    return;
  }

  sendCommand(trimmed);
});

let stdinClosed = false;
rl.on("close", () => {
  stdinClosed = true;
  if (ready && pendingCommands.length === 0) {
    ws.close();
  }
});
