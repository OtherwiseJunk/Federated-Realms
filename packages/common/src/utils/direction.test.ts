import { describe, expect, test } from "bun:test";
import { resolveDirection, isDirection, OPPOSITE_DIRECTION } from "./direction.js";

describe("resolveDirection", () => {
  test("resolves full direction names", () => {
    expect(resolveDirection("north")).toBe("north");
    expect(resolveDirection("south")).toBe("south");
    expect(resolveDirection("east")).toBe("east");
    expect(resolveDirection("west")).toBe("west");
    expect(resolveDirection("up")).toBe("up");
    expect(resolveDirection("down")).toBe("down");
  });

  test("resolves single-letter abbreviations", () => {
    expect(resolveDirection("n")).toBe("north");
    expect(resolveDirection("s")).toBe("south");
    expect(resolveDirection("e")).toBe("east");
    expect(resolveDirection("w")).toBe("west");
    expect(resolveDirection("u")).toBe("up");
    expect(resolveDirection("d")).toBe("down");
  });

  test("resolves diagonal abbreviations", () => {
    expect(resolveDirection("ne")).toBe("northeast");
    expect(resolveDirection("nw")).toBe("northwest");
    expect(resolveDirection("se")).toBe("southeast");
    expect(resolveDirection("sw")).toBe("southwest");
  });

  test("is case-insensitive", () => {
    expect(resolveDirection("NORTH")).toBe("north");
    expect(resolveDirection("North")).toBe("north");
    expect(resolveDirection("N")).toBe("north");
  });

  test("returns undefined for invalid directions", () => {
    expect(resolveDirection("sideways")).toBeUndefined();
    expect(resolveDirection("")).toBeUndefined();
    expect(resolveDirection("x")).toBeUndefined();
  });

  test("does not resolve Object.prototype members as directions", () => {
    expect(resolveDirection("hasOwnProperty")).toBeUndefined();
    expect(resolveDirection("toString")).toBeUndefined();
    expect(resolveDirection("constructor")).toBeUndefined();
    expect(resolveDirection("__proto__")).toBeUndefined();
  });
});

describe("isDirection", () => {
  test("returns true for valid directions", () => {
    expect(isDirection("north")).toBe(true);
    expect(isDirection("southeast")).toBe(true);
    expect(isDirection("up")).toBe(true);
  });

  test("returns false for invalid directions", () => {
    expect(isDirection("sideways")).toBe(false);
  });
});

describe("OPPOSITE_DIRECTION", () => {
  test("maps north to south", () => {
    expect(OPPOSITE_DIRECTION.north).toBe("south");
    expect(OPPOSITE_DIRECTION.south).toBe("north");
  });

  test("maps east to west", () => {
    expect(OPPOSITE_DIRECTION.east).toBe("west");
    expect(OPPOSITE_DIRECTION.west).toBe("east");
  });

  test("maps up to down", () => {
    expect(OPPOSITE_DIRECTION.up).toBe("down");
    expect(OPPOSITE_DIRECTION.down).toBe("up");
  });

  test("maps diagonals", () => {
    expect(OPPOSITE_DIRECTION.northeast).toBe("southwest");
    expect(OPPOSITE_DIRECTION.southwest).toBe("northeast");
  });
});
