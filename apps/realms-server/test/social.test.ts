import { describe, expect, test } from "bun:test";
import { capChatMessage, MAX_CHAT_MESSAGE_LENGTH } from "../src/commands/social.js";

describe("capChatMessage", () => {
  test("matches the chat lexicon maxLength", () => {
    expect(MAX_CHAT_MESSAGE_LENGTH).toBe(2000);
  });

  test("leaves a message under the cap unchanged", () => {
    const msg = "hello there";
    expect(capChatMessage(msg)).toBe(msg);
  });

  test("leaves a message exactly at the cap unchanged", () => {
    const msg = "x".repeat(MAX_CHAT_MESSAGE_LENGTH);
    const out = capChatMessage(msg);
    expect(out.length).toBe(MAX_CHAT_MESSAGE_LENGTH);
    expect(out).toBe(msg);
  });

  test("truncates a message over the cap to exactly the cap", () => {
    const msg = "y".repeat(MAX_CHAT_MESSAGE_LENGTH + 5000);
    expect(capChatMessage(msg).length).toBe(MAX_CHAT_MESSAGE_LENGTH);
  });

  test("respects an explicit lower cap", () => {
    expect(capChatMessage("abcdef", 3)).toBe("abc");
  });

  test("passes empty strings through", () => {
    expect(capChatMessage("")).toBe("");
  });
});
