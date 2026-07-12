import { describe, expect, test } from "bun:test";
import { parseCommand, getCommandHelp } from "./command-parser.js";

describe("parseCommand", () => {
  test("parses simple verb", () => {
    const cmd = parseCommand("look");
    expect(cmd.verb).toBe("look");
    expect(cmd.args).toEqual([]);
    expect(cmd.target).toBeUndefined();
  });

  test("parses verb with single arg", () => {
    const cmd = parseCommand("look sword");
    expect(cmd.verb).toBe("look");
    expect(cmd.args).toEqual(["sword"]);
    expect(cmd.target).toBe("sword");
  });

  test("parses verb with multiple args", () => {
    const cmd = parseCommand("whisper alice hello there");
    expect(cmd.verb).toBe("whisper");
    expect(cmd.args).toEqual(["alice", "hello", "there"]);
    expect(cmd.target).toBe("alice hello there");
  });

  test("handles empty input", () => {
    const cmd = parseCommand("");
    expect(cmd.verb).toBe("");
    expect(cmd.args).toEqual([]);
  });

  test("handles whitespace-only input", () => {
    const cmd = parseCommand("   ");
    expect(cmd.verb).toBe("");
    expect(cmd.args).toEqual([]);
  });

  test("trims whitespace", () => {
    const cmd = parseCommand("  look  sword  ");
    expect(cmd.verb).toBe("look");
    expect(cmd.args).toEqual(["sword"]);
  });

  test("converts verb to lowercase", () => {
    const cmd = parseCommand("LOOK");
    expect(cmd.verb).toBe("look");
  });

  describe("aliases", () => {
    test("l -> look", () => {
      expect(parseCommand("l").verb).toBe("look");
    });

    test("i -> inventory", () => {
      expect(parseCommand("i").verb).toBe("inventory");
    });

    test("inv -> inventory", () => {
      expect(parseCommand("inv").verb).toBe("inventory");
    });

    test("ex -> examine", () => {
      const cmd = parseCommand("ex sword");
      expect(cmd.verb).toBe("examine");
      expect(cmd.args).toEqual(["sword"]);
    });

    test("get -> take", () => {
      const cmd = parseCommand("get torch");
      expect(cmd.verb).toBe("take");
      expect(cmd.args).toEqual(["torch"]);
    });

    test("? -> help", () => {
      expect(parseCommand("?").verb).toBe("help");
    });
  });

  describe("direction shortcuts", () => {
    test("n -> go north", () => {
      const cmd = parseCommand("n");
      expect(cmd.verb).toBe("go");
      expect(cmd.args).toEqual(["north"]);
    });

    test("s -> go south", () => {
      const cmd = parseCommand("s");
      expect(cmd.verb).toBe("go");
      expect(cmd.args).toEqual(["south"]);
    });

    test("e -> go east", () => {
      const cmd = parseCommand("e");
      expect(cmd.verb).toBe("go");
      expect(cmd.args).toEqual(["east"]);
    });

    test("w -> go west", () => {
      const cmd = parseCommand("w");
      expect(cmd.verb).toBe("go");
      expect(cmd.args).toEqual(["west"]);
    });

    test("u -> go up", () => {
      const cmd = parseCommand("u");
      expect(cmd.verb).toBe("go");
      expect(cmd.args).toEqual(["up"]);
    });

    test("d -> go down", () => {
      const cmd = parseCommand("d");
      expect(cmd.verb).toBe("go");
      expect(cmd.args).toEqual(["down"]);
    });

    test("ne -> go northeast", () => {
      const cmd = parseCommand("ne");
      expect(cmd.verb).toBe("go");
      expect(cmd.args).toEqual(["northeast"]);
    });

    test("north -> go north", () => {
      const cmd = parseCommand("north");
      expect(cmd.verb).toBe("go");
      expect(cmd.args).toEqual(["north"]);
    });

    test("go north -> go north", () => {
      const cmd = parseCommand("go north");
      expect(cmd.verb).toBe("go");
      expect(cmd.args).toEqual(["north"]);
    });

    test("go n -> resolves to go north", () => {
      const cmd = parseCommand("go n");
      expect(cmd.verb).toBe("go");
      expect(cmd.args).toEqual(["north"]);
    });
  });

  describe("prototype-chain safety", () => {
    test("toString is not treated as an alias", () => {
      const cmd = parseCommand("toString");
      expect(cmd.verb).toBe("tostring");
    });

    test("constructor is not treated as an alias", () => {
      const cmd = parseCommand("constructor");
      expect(cmd.verb).toBe("constructor");
    });

    test("__proto__ is not treated as an alias", () => {
      const cmd = parseCommand("__proto__");
      expect(cmd.verb).toBe("__proto__");
    });

    test("go constructor is not treated as a direction", () => {
      const cmd = parseCommand("go constructor");
      expect(cmd.verb).toBe("go");
      expect(cmd.args).toEqual(["constructor"]);
      expect(cmd.target).toBe("constructor");
    });
  });
});

describe("getCommandHelp", () => {
  test("returns array of help lines", () => {
    const help = getCommandHelp();
    expect(Array.isArray(help)).toBe(true);
    expect(help.length).toBeGreaterThan(0);
  });

  test("includes movement help", () => {
    const help = getCommandHelp();
    expect(help.some((l) => l.includes("Movement"))).toBe(true);
  });

  test("includes NPC help", () => {
    const help = getCommandHelp();
    expect(help.some((l) => l.includes("talk"))).toBe(true);
  });
});
