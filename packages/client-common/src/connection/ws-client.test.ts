import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { WsClient } from "./ws-client.js";
import type { ServerMessage } from "@realms/protocol";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }
}

const RealWebSocket = globalThis.WebSocket;

beforeEach(() => {
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket as never;
});

afterEach(() => {
  globalThis.WebSocket = RealWebSocket;
});

function connect(client: WsClient): FakeWebSocket {
  client.connectWithSession({ url: "ws://server-a/ws", sessionId: "s1" });
  const socket = FakeWebSocket.instances.at(-1)!;
  socket.onopen?.();
  return socket;
}

describe("WsClient", () => {
  test("connects and sends commands", () => {
    const client = new WsClient();
    const socket = connect(client);

    expect(client.connected).toBe(true);
    client.sendCommand("look");
    expect(socket.sent).toHaveLength(1);
  });

  test("close of the current socket disconnects and notifies handlers", () => {
    const client = new WsClient();
    const socket = connect(client);
    const received: ServerMessage[] = [];
    client.onMessage((msg) => received.push(msg));

    socket.onclose?.();

    expect(client.connected).toBe(false);
    expect(received).toEqual([
      { type: "error", code: "DISCONNECTED", message: "Connection closed" },
    ]);
  });

  test("stale onclose after switchServer does not drop the new connection", () => {
    const client = new WsClient();
    const oldSocket = connect(client);
    const received: ServerMessage[] = [];
    client.onMessage((msg) => received.push(msg));

    client.switchServer("ws://server-b/ws", "s2");
    const newSocket = FakeWebSocket.instances.at(-1)!;
    newSocket.onopen?.();
    expect(client.connected).toBe(true);

    // Late close event from the socket switchServer already discarded
    oldSocket.onclose?.();

    expect(client.connected).toBe(true);
    expect(received).toHaveLength(0);

    client.sendCommand("look");
    expect(newSocket.sent).toHaveLength(1);
  });

  test("stale onmessage after switchServer is not dispatched", () => {
    const client = new WsClient();
    const oldSocket = connect(client);
    const received: ServerMessage[] = [];
    client.onMessage((msg) => received.push(msg));

    client.switchServer("ws://server-b/ws", "s2");
    FakeWebSocket.instances.at(-1)!.onopen?.();

    oldSocket.onmessage?.({ data: JSON.stringify({ type: "narrative", text: "ghost" }) });

    expect(received).toHaveLength(0);
  });

  test("disconnect closes the socket without a spurious error broadcast", () => {
    const client = new WsClient();
    const socket = connect(client);
    const received: ServerMessage[] = [];
    client.onMessage((msg) => received.push(msg));

    client.disconnect();
    socket.onclose?.();

    expect(client.connected).toBe(false);
    expect(received).toHaveLength(0);
  });
});
