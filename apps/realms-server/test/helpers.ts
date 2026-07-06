import type { Subprocess } from "bun";
import { decodeServerMessage, type ServerMessage } from "@realms/protocol";
import { parseCommand } from "@realms/common";
import { encodeMessage, type ClientMessage } from "@realms/protocol";

/** A test WebSocket client that collects messages */
export class TestClient {
  private ws: WebSocket | null = null;
  private messages: ServerMessage[] = [];
  private waitResolvers: Array<(msg: ServerMessage) => void> = [];
  private cmdId = 0;
  readonly name: string;

  constructor(name: string = "TestHero") {
    this.name = name;
  }

  async connect(port: number, opts?: { classId?: string; raceId?: string }): Promise<void> {
    const classId = opts?.classId ?? "warrior";
    const raceId = opts?.raceId ?? "human";
    const url = `ws://localhost:${port}/ws?name=${encodeURIComponent(this.name)}&class=${classId}&race=${raceId}`;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => resolve();

      this.ws.onmessage = (event) => {
        const data = typeof event.data === "string" ? event.data : event.data.toString();
        const msg = decodeServerMessage(data);
        if (!msg) return;

        this.messages.push(msg);

        // Resolve any pending waiters
        const resolvers = this.waitResolvers.splice(0);
        for (const resolve of resolvers) {
          resolve(msg);
        }
      };

      this.ws.onerror = () => reject(new Error("WebSocket connection failed"));
      this.ws.onclose = () => {};

      setTimeout(() => reject(new Error("Connection timeout")), 5000);
    });
  }

  /** Connect to a pre-existing session (e.g. from XRPC or transfer) */
  async connectToSession(port: number, sessionId: string): Promise<void> {
    const url = `ws://localhost:${port}/ws?session=${encodeURIComponent(sessionId)}`;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => resolve();

      this.ws.onmessage = (event) => {
        const data = typeof event.data === "string" ? event.data : event.data.toString();
        const msg = decodeServerMessage(data);
        if (!msg) return;

        this.messages.push(msg);

        const resolvers = this.waitResolvers.splice(0);
        for (const resolve of resolvers) {
          resolve(msg);
        }
      };

      this.ws.onerror = () => reject(new Error("WebSocket connection failed"));
      this.ws.onclose = () => {};

      setTimeout(() => reject(new Error("Connection timeout")), 5000);
    });
  }

  /** Send a raw JSON message over the WebSocket */
  sendRaw(msg: Record<string, unknown>): void {
    if (!this.ws) throw new Error("Not connected");
    this.ws.send(JSON.stringify(msg));
  }

  /** Send a raw game command (like typing in the client) */
  command(input: string): void {
    if (!this.ws) throw new Error("Not connected");

    const parsed = parseCommand(input);
    const id = String(++this.cmdId);

    const msg: ClientMessage = {
      type: "command",
      id,
      command: parsed.verb,
      args: parsed.args,
    };

    this.ws.send(encodeMessage(msg));
  }

  /** Wait for a specific message type, with timeout */
  async waitFor<T extends ServerMessage["type"]>(
    type: T,
    timeoutMs: number = 2000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    // Check already-received messages first
    const existing = this.messages.find((m) => m.type === type);
    if (existing) {
      this.messages = this.messages.filter((m) => m !== existing);
      return existing as Extract<ServerMessage, { type: T }>;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waitResolvers = this.waitResolvers.filter((r) => r !== handler);
        reject(new Error(`Timeout waiting for message type: ${type}`));
      }, timeoutMs);

      const handler = (msg: ServerMessage) => {
        if (msg.type === type) {
          clearTimeout(timer);
          this.waitResolvers = this.waitResolvers.filter((r) => r !== handler);
          resolve(msg as Extract<ServerMessage, { type: T }>);
        } else {
          // Re-register if this wasn't the right type
          this.waitResolvers.push(handler);
        }
      };

      this.waitResolvers.push(handler);
    });
  }

  /** Send a command and wait for a narrative response */
  async commandAndWait(input: string): Promise<string> {
    this.clearMessages();
    this.command(input);
    const msg = await this.waitFor("narrative");
    return msg.text;
  }

  /** Send a command and wait for room_state */
  async commandAndWaitRoom(input: string): Promise<Extract<ServerMessage, { type: "room_state" }>> {
    this.clearMessages();
    this.command(input);
    return this.waitFor("room_state");
  }

  /** Get all collected messages */
  getMessages(): ServerMessage[] {
    return [...this.messages];
  }

  /** Get messages of a specific type */
  getMessagesOfType<T extends ServerMessage["type"]>(
    type: T,
  ): Extract<ServerMessage, { type: T }>[] {
    return this.messages.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
  }

  /** Clear collected messages */
  clearMessages(): void {
    this.messages = [];
  }

  /** Disconnect */
  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  /** Small delay to let server process */
  async tick(ms: number = 100): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }
}

/** Start the realms server on a random port */
export async function startServer(opts?: {
  devMode?: boolean;
  env?: Record<string, string>;
}): Promise<{ port: number; process: Subprocess }> {
  const port = 10000 + Math.floor(Math.random() * 50000);
  const serverPath = decodeURIComponent(new URL("../src/index.ts", import.meta.url).pathname);
  const devMode = opts?.devMode ?? true;

  const proc = Bun.spawn(["bun", "run", serverPath], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      BLUESKY_ENABLED: "false",
      DEV_MODE: devMode ? "true" : "false",
      ...opts?.env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for server to be ready by polling /health
  const healthUrl = `http://127.0.0.1:${port}/health`;
  const start = Date.now();
  while (Date.now() - start < 10000) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) return { port, process: proc };
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  proc.kill();
  throw new Error(`Server failed to start on port ${port}`);
}

/** Stop the server */
export function stopServer(proc: Subprocess): void {
  proc.kill();
}
