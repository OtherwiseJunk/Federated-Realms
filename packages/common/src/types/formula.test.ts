import { describe, expect, test } from "bun:test";
import { evaluateFormula } from "./formula.ts";

describe("evaluateFormula — arithmetic", () => {
  test("evaluates simple arithmetic", () => {
    expect(evaluateFormula("2 + 3", {})).toBe(5);
    expect(evaluateFormula("10 - 4", {})).toBe(6);
    expect(evaluateFormula("3 * 4", {})).toBe(12);
    expect(evaluateFormula("10 / 3", {})).toBe(3); // final result floored
  });

  test("honours operator precedence and parentheses", () => {
    expect(evaluateFormula("2 + 3 * 4", {})).toBe(14);
    expect(evaluateFormula("(2 + 3) * 4", {})).toBe(20);
    expect(evaluateFormula("20 - 4 * 3", {})).toBe(8);
    expect(evaluateFormula("(str + con) * 2", { str: 10, con: 12 })).toBe(44);
  });

  test("supports unary minus and plus", () => {
    expect(evaluateFormula("-5 + 8", {})).toBe(3);
    expect(evaluateFormula("abs(-5)", {})).toBe(5);
    expect(evaluateFormula("3 * -2", {})).toBe(-6);
    expect(evaluateFormula("+7", {})).toBe(7);
  });

  test("supports whitelisted functions", () => {
    expect(evaluateFormula("floor(7.8)", {})).toBe(7);
    expect(evaluateFormula("ceil(7.2)", {})).toBe(8);
    expect(evaluateFormula("max(5, 10)", {})).toBe(10);
    expect(evaluateFormula("min(5, 10)", {})).toBe(5);
    expect(evaluateFormula("abs(-5)", {})).toBe(5);
  });

  test("substitutes variables by token, not string", () => {
    expect(evaluateFormula("str + 10", { str: 14 })).toBe(24);
    expect(evaluateFormula("level * 5", { level: 3 })).toBe(15);
    expect(evaluateFormula("str + con + level", { str: 14, con: 12, level: 3 })).toBe(29);
  });

  test("evaluates every shipped reference-system formula", () => {
    const vars = { level: 3, con: 13, int: 10, dex: 12, str: 14, wis: 10 };
    expect(evaluateFormula("20 + (level - 1) * 8 + floor(con / 2)", vars)).toBe(42);
    expect(evaluateFormula("10 + (level - 1) * 4 + floor(int / 3)", vars)).toBe(21);
    expect(evaluateFormula("4 + floor((dex - 10) / 4)", vars)).toBe(4);
    expect(evaluateFormula("50 + str * 5", vars)).toBe(120);
  });

  test("floors the final result and returns 0 for non-finite results", () => {
    expect(evaluateFormula("10 / 3", {})).toBe(3);
    expect(evaluateFormula("0 / 0", {})).toBe(0); // NaN -> 0
    expect(evaluateFormula("1 / 0", {})).toBe(0); // Infinity -> 0
  });
});

describe("evaluateFormula — substitution safety (regression)", () => {
  // The previous implementation string-replaced each variable name into the
  // expression, so a variable whose name is a substring of a function name (or
  // another token) corrupted the expression. A single-letter attribute `a`
  // turned `max(a, 10)` into `m2x(2, 10)`. Token-based substitution fixes this.
  test("a single-letter variable does not corrupt a function name", () => {
    expect(evaluateFormula("max(a, 10)", { a: 2 })).toBe(10);
    expect(evaluateFormula("abs(x)", { x: -7 })).toBe(7); // 'x' is inside 'max'/'abs'
  });

  test("a variable named like a function-name substring is not confused", () => {
    // 'in' is a substring of 'min'; must not corrupt the min() call.
    expect(evaluateFormula("min(in, 3)", { in: 9 })).toBe(3);
  });

  test("a variable that is a prefix of another variable is substituted exactly", () => {
    expect(evaluateFormula("str + strength", { str: 2, strength: 40 })).toBe(42);
  });
});

describe("evaluateFormula — rejects non-arithmetic input", () => {
  test("throws on global/host access attempts", () => {
    expect(() => evaluateFormula("process.exit()", {})).toThrow("Invalid formula");
    expect(() => evaluateFormula("globalThis", {})).toThrow("Invalid formula");
    expect(() => evaluateFormula("require('fs')", {})).toThrow("Invalid formula");
    expect(() => evaluateFormula("constructor", {})).toThrow("Invalid formula");
    expect(() => evaluateFormula("this", {})).toThrow("Invalid formula");
  });

  test("throws on unknown variables", () => {
    expect(() => evaluateFormula("mystery + 1", {})).toThrow("Invalid formula");
  });

  test("throws on unknown functions", () => {
    expect(() => evaluateFormula("sqrt(9)", {})).toThrow("Invalid formula");
    expect(() => evaluateFormula("pow(2, 3)", {})).toThrow("Invalid formula");
  });

  test("throws on wrong function arity", () => {
    expect(() => evaluateFormula("floor(1, 2)", {})).toThrow("Invalid formula");
    expect(() => evaluateFormula("max(5)", {})).toThrow("Invalid formula");
  });

  test("throws on malformed expressions", () => {
    expect(() => evaluateFormula("2 +", {})).toThrow("Invalid formula");
    expect(() => evaluateFormula("(2 + 3", {})).toThrow("Invalid formula");
    expect(() => evaluateFormula("2 3", {})).toThrow("Invalid formula");
    expect(() => evaluateFormula("", {})).toThrow("Invalid formula");
  });

  test("throws on assignment / statements", () => {
    expect(() => evaluateFormula("x = 1", { x: 0 })).toThrow("Invalid formula");
    expect(() => evaluateFormula("1; 2", {})).toThrow("Invalid formula");
  });

  test("throws on over-long input before parsing (recursion guard)", () => {
    const deep = "(".repeat(600) + "1" + ")".repeat(600); // 1201 chars, deeply nested
    expect(() => evaluateFormula(deep, {})).toThrow("Invalid formula");
  });
});
