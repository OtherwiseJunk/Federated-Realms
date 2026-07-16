import { describe, expect, test } from "bun:test";
import { appendNarrativeLines, newlyCompletedObjectives } from "./use-game-state.js";
import type { NarrativeLine } from "./use-game-state.js";
import type { QuestObjective } from "@realms/protocol";

function line(text: string): NarrativeLine {
  return { text, style: "info", timestamp: 0 };
}

function lines(count: number, prefix = "l"): NarrativeLine[] {
  return Array.from({ length: count }, (_, i) => line(`${prefix}${i}`));
}

function objective(description: string, done: boolean): QuestObjective {
  return { description, current: done ? 1 : 0, required: 1, done };
}

describe("appendNarrativeLines", () => {
  test("keeps everything when under the cap", () => {
    const result = appendNarrativeLines(lines(2, "a"), lines(3, "b"), 10);
    expect(result.map((l) => l.text)).toEqual(["a0", "a1", "b0", "b1", "b2"]);
  });

  test("keeps only the last `max` lines when the combined log overflows", () => {
    const result = appendNarrativeLines(lines(8, "a"), lines(4, "b"), 5);
    expect(result).toHaveLength(5);
    // newest lines survive, oldest are dropped
    expect(result.map((l) => l.text)).toEqual(["a7", "b0", "b1", "b2", "b3"]);
  });

  test("a single message larger than the cap is trimmed to the newest `max` lines", () => {
    // The previous slice(-(max - additions)) math went positive here and both
    // sliced from the wrong end and blew past the cap; this is the regression.
    const result = appendNarrativeLines(lines(3, "old"), lines(600, "big"), 500);
    expect(result).toHaveLength(500);
    expect(result[0]?.text).toBe("big100");
    expect(result.at(-1)?.text).toBe("big599");
    // none of the previous log survives when the new message alone exceeds max
    expect(result.some((l) => l.text.startsWith("old"))).toBe(false);
  });

  test("defaults to the 500-line cap", () => {
    const result = appendNarrativeLines([], lines(700, "x"));
    expect(result).toHaveLength(500);
    expect(result.at(-1)?.text).toBe("x699");
  });
});

describe("newlyCompletedObjectives", () => {
  test("with no prior snapshot, reports objectives currently done", () => {
    const objs = [objective("gather wood", true), objective("light fire", false)];
    expect(newlyCompletedObjectives(undefined, objs).map((o) => o.description)).toEqual([
      "gather wood",
    ]);
  });

  test("reports only objectives that transitioned to done", () => {
    const prev = [true, false, false];
    const objs = [objective("a", true), objective("b", true), objective("c", false)];
    expect(newlyCompletedObjectives(prev, objs).map((o) => o.description)).toEqual(["b"]);
  });

  test("does not re-announce an already-done objective on a later progress tick", () => {
    // objective 0 done previously; objective 1 merely ticks up but is not done.
    const prev = [true, false];
    const objs = [objective("first", true), objective("second", false)];
    expect(newlyCompletedObjectives(prev, objs)).toEqual([]);
  });

  test("reports nothing when nothing changed", () => {
    const prev = [true, true];
    const objs = [objective("a", true), objective("b", true)];
    expect(newlyCompletedObjectives(prev, objs)).toEqual([]);
  });
});
