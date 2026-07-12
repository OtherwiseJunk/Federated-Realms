import { describe, expect, test } from "bun:test";
import { encodeMessage, decodeClientMessage, decodeServerMessage } from "./messages.js";
import type { ClientMessage, ServerMessage } from "./messages.js";

describe("encodeMessage", () => {
  test("encodes client message to JSON", () => {
    const msg: ClientMessage = { type: "command", id: "1", command: "look", args: [] };
    const encoded = encodeMessage(msg);
    expect(JSON.parse(encoded)).toEqual(msg);
  });

  test("encodes server message to JSON", () => {
    const msg: ServerMessage = { type: "narrative", text: "Hello", style: "info" };
    const encoded = encodeMessage(msg);
    expect(JSON.parse(encoded)).toEqual(msg);
  });
});

describe("decodeClientMessage", () => {
  test("decodes valid command message", () => {
    const msg = decodeClientMessage('{"type":"command","id":"1","command":"look","args":[]}');
    expect(msg).toEqual({ type: "command", id: "1", command: "look", args: [] });
  });

  test("decodes move message", () => {
    const msg = decodeClientMessage('{"type":"move","id":"1","direction":"north"}');
    expect(msg?.type).toBe("move");
  });

  test("decodes chat message", () => {
    const msg = decodeClientMessage('{"type":"chat","channel":"room","message":"hello"}');
    expect(msg?.type).toBe("chat");
  });

  test("returns null for invalid JSON", () => {
    expect(decodeClientMessage("not json")).toBeNull();
  });

  test("returns null for non-object", () => {
    expect(decodeClientMessage('"just a string"')).toBeNull();
    expect(decodeClientMessage("42")).toBeNull();
  });

  test("returns null for missing type", () => {
    expect(decodeClientMessage('{"command":"look"}')).toBeNull();
  });

  test("returns null for unknown type", () => {
    expect(decodeClientMessage('{"type":"hax"}')).toBeNull();
  });

  test("returns null for command message missing fields", () => {
    expect(decodeClientMessage('{"type":"command"}')).toBeNull();
    expect(decodeClientMessage('{"type":"command","id":"1"}')).toBeNull();
    expect(decodeClientMessage('{"type":"command","id":"1","command":"look"}')).toBeNull();
  });

  test("returns null for command args that are not an array of strings", () => {
    expect(
      decodeClientMessage('{"type":"command","id":"1","command":"look","args":"north"}'),
    ).toBeNull();
    expect(
      decodeClientMessage('{"type":"command","id":"1","command":"look","args":[1]}'),
    ).toBeNull();
    expect(
      decodeClientMessage('{"type":"command","id":"1","command":"look","args":[null]}'),
    ).toBeNull();
  });

  test("returns null for move message with missing or non-string direction", () => {
    expect(decodeClientMessage('{"type":"move","id":"1"}')).toBeNull();
    expect(decodeClientMessage('{"type":"move","id":"1","direction":5}')).toBeNull();
  });

  test("returns null for chat message missing fields", () => {
    expect(decodeClientMessage('{"type":"chat","channel":"room"}')).toBeNull();
    expect(decodeClientMessage('{"type":"chat","message":"hi"}')).toBeNull();
    expect(decodeClientMessage('{"type":"chat","channel":"room","message":42}')).toBeNull();
  });

  test("returns null for interact message missing fields", () => {
    expect(decodeClientMessage('{"type":"interact","id":"1"}')).toBeNull();
    expect(decodeClientMessage('{"type":"interact","id":"1","targetId":"npc"}')).toBeNull();
  });

  test("decodes valid interact message", () => {
    const msg = decodeClientMessage(
      '{"type":"interact","id":"1","targetId":"npc","action":"talk"}',
    );
    expect(msg?.type).toBe("interact");
  });

  test("decodes adaptation_response with and without optional fields", () => {
    expect(decodeClientMessage('{"type":"adaptation_response"}')).toEqual({
      type: "adaptation_response",
    });
    expect(decodeClientMessage('{"type":"adaptation_response","classId":"mage"}')).toEqual({
      type: "adaptation_response",
      classId: "mage",
    });
  });

  test("returns null for adaptation_response with non-string optional fields", () => {
    expect(decodeClientMessage('{"type":"adaptation_response","classId":5}')).toBeNull();
    expect(decodeClientMessage('{"type":"adaptation_response","raceId":{}}')).toBeNull();
  });

  test("decodes ping", () => {
    expect(decodeClientMessage('{"type":"ping"}')).toEqual({ type: "ping" });
  });
});

describe("decodeServerMessage", () => {
  test("decodes welcome message", () => {
    const msg = decodeServerMessage('{"type":"welcome","sessionId":"abc","serverName":"Test"}');
    expect(msg?.type).toBe("welcome");
    if (msg?.type === "welcome") {
      expect(msg.sessionId).toBe("abc");
      expect(msg.serverName).toBe("Test");
    }
  });

  test("decodes narrative message", () => {
    const msg = decodeServerMessage('{"type":"narrative","text":"Hello","style":"info"}');
    expect(msg?.type).toBe("narrative");
    if (msg?.type === "narrative") {
      expect(msg.text).toBe("Hello");
    }
  });

  test("returns null for invalid JSON", () => {
    expect(decodeServerMessage("broken")).toBeNull();
  });
});
