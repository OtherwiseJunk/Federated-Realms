import {
  encodeMessage,
  decodeServerMessage,
  type ClientMessage,
  type ServerMessage,
} from "@realms/protocol";
import { parseCommand } from "@realms/common";

export type MessageHandler = (msg: ServerMessage) => void;

export interface ConnectionOptions {
  host: string;
  port: number;
  tls: boolean;
  name: string;
  classId: string;
  raceId: string;
}

export interface SessionConnectionOptions {
  url: string;
  sessionId: string;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private cmdId = 0;
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  connect(opts: ConnectionOptions): void {
    const protocol = opts.tls ? "wss" : "ws";
    const defaultPort = opts.tls ? 443 : 80;
    const portSuffix = opts.port === defaultPort ? "" : `:${opts.port}`;
    const url = `${protocol}://${opts.host}${portSuffix}/ws?name=${encodeURIComponent(opts.name)}&class=${opts.classId}&race=${opts.raceId}`;
    this.openSocket(url);
  }

  connectWithSession(opts: SessionConnectionOptions): void {
    const url = opts.url.includes("?")
      ? `${opts.url}&session=${opts.sessionId}`
      : `${opts.url}?session=${opts.sessionId}`;
    this.openSocket(url);
  }

  switchServer(websocketUrl: string, sessionId: string): void {
    this.disconnect();
    const url = websocketUrl.includes("?")
      ? `${websocketUrl}&session=${sessionId}`
      : `${websocketUrl}?session=${sessionId}`;
    this.openSocket(url);
  }

  private openSocket(url: string): void {
    // Events from a replaced socket (disconnect/switchServer) must not
    // touch shared state, so every handler checks it still owns this.ws.
    const socket = new WebSocket(url);
    this.ws = socket;
    // Distinguish a socket that never opened (connect failed) from an
    // established one that later dropped, so the UI can report the right thing
    // instead of leaving the user on a permanent "Connecting..." screen.
    let opened = false;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      opened = true;
      this._connected = true;
    };

    socket.onmessage = (event) => {
      if (this.ws !== socket) return;
      const data = typeof event.data === "string" ? event.data : String(event.data);
      const msg = decodeServerMessage(data);
      if (msg) {
        for (const handler of this.handlers) {
          handler(msg);
        }
      }
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      this._connected = false;
      const error: ServerMessage = opened
        ? { type: "error", code: "DISCONNECTED", message: "Connection closed" }
        : { type: "error", code: "CONNECT_ERROR", message: "Could not connect to server" };
      for (const handler of this.handlers) {
        handler(error);
      }
    };

    socket.onerror = () => {
      if (this.ws !== socket) return;
      this._connected = false;
    };
  }

  sendCommand(input: string): void {
    if (!this.ws || !this._connected) return;

    if (input === "quit" || input === "disconnect") {
      this.ws.close();
      return;
    }

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

  sendRaw(msg: ClientMessage): void {
    if (!this.ws || !this._connected) return;
    this.ws.send(encodeMessage(msg));
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this._connected = false;
  }
}
