import { describe, expect, test } from "bun:test";
import { validateCreateCharacterInput } from "../src/create-character.ts";

describe("validateCreateCharacterInput", () => {
  test("rejects an over-long name with a field-named error", () => {
    const result = validateCreateCharacterInput({
      name: "x".repeat(65),
      classId: "warrior",
      raceId: "human",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.toLowerCase()).toContain("name");
  });

  test("normalizes the name (trims and collapses whitespace)", () => {
    const result = validateCreateCharacterInput({
      name: "  Sir   Kai  ",
      classId: "warrior",
      raceId: "human",
    });
    expect(result).toEqual({
      ok: true,
      name: "Sir Kai",
      classId: "warrior",
      raceId: "human",
    });
  });

  test("rejects an over-long classId with a field-named error", () => {
    const result = validateCreateCharacterInput({
      name: "Hero",
      classId: "c".repeat(65),
      raceId: "human",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("classId");
  });

  test("rejects an over-long raceId with a field-named error", () => {
    const result = validateCreateCharacterInput({
      name: "Hero",
      classId: "warrior",
      raceId: "r".repeat(65),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("raceId");
  });

  test("passes a valid unicode/emoji name through normalized", () => {
    const result = validateCreateCharacterInput({
      name: "  Café \u{1F600}  ",
      classId: "mage",
      raceId: "elf",
    });
    expect(result).toEqual({
      ok: true,
      name: "Café \u{1F600}",
      classId: "mage",
      raceId: "elf",
    });
  });
});
