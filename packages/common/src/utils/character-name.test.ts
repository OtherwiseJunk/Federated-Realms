import { describe, expect, test } from "bun:test";
import { validateCharacterName, handleLocalPart } from "./character-name.js";

describe("validateCharacterName", () => {
  test("trims and accepts a normal name", () => {
    expect(validateCharacterName("  Bodacious  ")).toEqual({ ok: true, name: "Bodacious" });
  });
  test("collapses internal whitespace", () => {
    expect(validateCharacterName("Sir   Kai")).toEqual({ ok: true, name: "Sir Kai" });
  });
  test("rejects empty after trim", () => {
    expect(validateCharacterName("   ")).toMatchObject({ ok: false });
  });
  test("rejects control characters", () => {
    expect(validateCharacterName("bad\u0007name")).toMatchObject({ ok: false });
  });
  test("rejects bidi override characters", () => {
    expect(validateCharacterName("a\u202Eb")).toMatchObject({ ok: false });
  });
  test("accepts 64 graphemes, rejects 65", () => {
    expect(validateCharacterName("a".repeat(64))).toMatchObject({ ok: true });
    expect(validateCharacterName("a".repeat(65))).toMatchObject({ ok: false });
  });
  test("counts graphemes, not code units (emoji is one)", () => {
    expect(validateCharacterName("\u{1F600}".repeat(64))).toMatchObject({ ok: true });
  });
  test("NFC-normalizes decomposed input", () => {
    expect(validateCharacterName("Café")).toEqual({ ok: true, name: "Café" });
  });
  test("rejects zero-width / invisible format characters", () => {
    expect(validateCharacterName("ab\u200Bcd")).toMatchObject({ ok: false });
    expect(validateCharacterName("ab\uFEFFcd")).toMatchObject({ ok: false });
  });
  test("rejects a name with no visible character", () => {
    expect(validateCharacterName("\u0301\u0301")).toMatchObject({ ok: false });
  });
  test("rejects reserved / impersonation names (case-insensitive)", () => {
    expect(validateCharacterName("System")).toMatchObject({ ok: false });
    expect(validateCharacterName("  admin ")).toMatchObject({ ok: false });
  });
});

describe("handleLocalPart", () => {
  test("strips the domain suffix", () => {
    expect(handleLocalPart("bodacious.fmpds.cacheblasters.com")).toBe("bodacious");
  });
  test("returns empty for a DID", () => {
    expect(handleLocalPart("did:plc:abc123")).toBe("");
  });
  test("passes a bare token through", () => {
    expect(handleLocalPart("bodacious")).toBe("bodacious");
  });
});
