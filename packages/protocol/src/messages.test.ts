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

  test("returns null for non-object and missing/unknown type", () => {
    expect(decodeServerMessage('"just a string"')).toBeNull();
    expect(decodeServerMessage("42")).toBeNull();
    expect(decodeServerMessage('{"sessionId":"abc"}')).toBeNull();
    expect(decodeServerMessage('{"type":"totally_made_up"}')).toBeNull();
  });

  test("validates welcome fields", () => {
    expect(decodeServerMessage('{"type":"welcome","sessionId":"a"}')).toBeNull();
    expect(decodeServerMessage('{"type":"welcome","sessionId":5,"serverName":"T"}')).toBeNull();
  });

  test("narrative rejects non-string text or style", () => {
    expect(decodeServerMessage('{"type":"narrative"}')).toBeNull();
    expect(decodeServerMessage('{"type":"narrative","text":42}')).toBeNull();
    expect(decodeServerMessage('{"type":"narrative","text":"hi","style":9}')).toBeNull();
    // style is optional
    expect(decodeServerMessage('{"type":"narrative","text":"hi"}')?.type).toBe("narrative");
  });

  test("decodes a full character_update and rejects a non-numeric field", () => {
    const ok = decodeServerMessage(
      '{"type":"character_update","hp":10,"maxHp":10,"mp":5,"maxMp":5,"ap":3,"maxAp":3,"gold":0,"level":1,"xp":0,"xpToNext":100}',
    );
    expect(ok?.type).toBe("character_update");
    // missing xpToNext
    expect(
      decodeServerMessage(
        '{"type":"character_update","hp":10,"maxHp":10,"mp":5,"maxMp":5,"ap":3,"maxAp":3,"gold":0,"level":1,"xp":0}',
      ),
    ).toBeNull();
    // hp is a string
    expect(
      decodeServerMessage(
        '{"type":"character_update","hp":"10","maxHp":10,"mp":5,"maxMp":5,"ap":3,"maxAp":3,"gold":0,"level":1,"xp":0,"xpToNext":100}',
      ),
    ).toBeNull();
  });

  test("map_update requires string-array grid/legend and numeric cursors", () => {
    expect(
      decodeServerMessage(
        '{"type":"map_update","grid":["#"],"cursorRow":0,"cursorCol":0,"legend":["# wall"]}',
      )?.type,
    ).toBe("map_update");
    expect(
      decodeServerMessage(
        '{"type":"map_update","grid":[1],"cursorRow":0,"cursorCol":0,"legend":[]}',
      ),
    ).toBeNull();
    expect(
      decodeServerMessage(
        '{"type":"map_update","grid":["#"],"cursorRow":"0","cursorCol":0,"legend":[]}',
      ),
    ).toBeNull();
  });

  test("quest_update validates the nested objectives array", () => {
    const ok = decodeServerMessage(
      '{"type":"quest_update","questId":"q1","questName":"Q","status":"active","objectives":[{"description":"d","current":0,"required":1,"done":false}]}',
    );
    expect(ok?.type).toBe("quest_update");
    // objective missing a field
    expect(
      decodeServerMessage(
        '{"type":"quest_update","questId":"q1","questName":"Q","status":"active","objectives":[{"description":"d","current":0,"required":1}]}',
      ),
    ).toBeNull();
    // bad status
    expect(
      decodeServerMessage(
        '{"type":"quest_update","questId":"q1","questName":"Q","status":"weird","objectives":[]}',
      ),
    ).toBeNull();
    // objectives not an array
    expect(
      decodeServerMessage(
        '{"type":"quest_update","questId":"q1","questName":"Q","status":"active","objectives":{}}',
      ),
    ).toBeNull();
  });

  test("quest_log validates each snapshot in the array", () => {
    expect(
      decodeServerMessage(
        '{"type":"quest_log","quests":[{"questId":"q","questName":"Q","status":"active","objectives":[]}]}',
      )?.type,
    ).toBe("quest_log");
    expect(decodeServerMessage('{"type":"quest_log","quests":[{"questId":"q"}]}')).toBeNull();
    expect(decodeServerMessage('{"type":"quest_log","quests":"nope"}')).toBeNull();
  });

  test("combat_update validates the combatants array", () => {
    expect(
      decodeServerMessage(
        '{"type":"combat_update","targetId":"g","combatants":[{"id":"g","name":"Goblin","level":1,"hp":5,"maxHp":5}]}',
      )?.type,
    ).toBe("combat_update");
    // combatant missing numeric hp
    expect(
      decodeServerMessage(
        '{"type":"combat_update","targetId":"g","combatants":[{"id":"g","name":"Goblin","level":1,"maxHp":5}]}',
      ),
    ).toBeNull();
  });

  test("portal_offer requires targetServer.name and a websocketUrl", () => {
    expect(
      decodeServerMessage(
        '{"type":"portal_offer","targetServer":{"name":"B","did":"did:x","endpoint":"e"},"sessionId":"s","websocketUrl":"ws://b/ws"}',
      )?.type,
    ).toBe("portal_offer");
    // targetServer is not an object with a name
    expect(
      decodeServerMessage(
        '{"type":"portal_offer","targetServer":"B","sessionId":"s","websocketUrl":"ws://b/ws"}',
      ),
    ).toBeNull();
    // missing websocketUrl
    expect(
      decodeServerMessage(
        '{"type":"portal_offer","targetServer":{"name":"B","did":"d","endpoint":"e"},"sessionId":"s"}',
      ),
    ).toBeNull();
  });

  test("mailbox validates each message so the state hook never dereferences a bad payload", () => {
    expect(decodeServerMessage('{"type":"mailbox","messages":[]}')?.type).toBe("mailbox");
    expect(
      decodeServerMessage(
        '{"type":"mailbox","messages":[{"senderName":"A","senderDid":"d","message":"hi","sourceServer":"s","sentAt":"t"}]}',
      )?.type,
    ).toBe("mailbox");
    // messages is not an array
    expect(decodeServerMessage('{"type":"mailbox","messages":{}}')).toBeNull();
    // a message missing fields
    expect(decodeServerMessage('{"type":"mailbox","messages":[{"senderName":"A"}]}')).toBeNull();
  });

  test("chat requires channel, sender and message", () => {
    expect(
      decodeServerMessage('{"type":"chat","channel":"shout","sender":"A","message":"hi"}')?.type,
    ).toBe("chat");
    expect(decodeServerMessage('{"type":"chat","channel":"shout","sender":"A"}')).toBeNull();
  });
});
