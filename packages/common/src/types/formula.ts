// ── Derived-stat formula evaluator ──
//
// Formulas (e.g. "20 + (level - 1) * 8 + floor(con / 2)") come from a server's
// published system records. They are authored by the server operator, but the
// evaluator treats them as untrusted input: it parses and interprets a fixed
// arithmetic grammar rather than compiling the string as code. There is NO
// `new Function`/`eval` here, so a formula can only ever produce a number — it
// cannot reach globals, `process`, or the host in any way, even if a malicious
// or malformed record slips through (defense in depth for federation, issue #28).
//
// Grammar (recursive descent):
//   expr   := term (("+" | "-") term)*
//   term   := factor (("*" | "/") factor)*
//   factor := ("+" | "-") factor
//           | number
//           | ident                      // variable reference
//           | ident "(" expr ("," expr)* ")"   // whitelisted function call
//           | "(" expr ")"
//
// Variables are resolved by exact token match (not string replacement), so an
// attribute whose name is a substring of another token — e.g. `a` inside
// `max`, or `in` inside `min` — can never corrupt the expression.

/** Whitelisted functions, keyed by name, with their fixed arity. */
const FUNCTIONS: Record<string, { arity: number; apply: (args: number[]) => number }> = {
  floor: { arity: 1, apply: (a) => Math.floor(a[0]) },
  ceil: { arity: 1, apply: (a) => Math.ceil(a[0]) },
  abs: { arity: 1, apply: (a) => Math.abs(a[0]) },
  min: { arity: 2, apply: (a) => Math.min(a[0], a[1]) },
  max: { arity: 2, apply: (a) => Math.max(a[0], a[1]) },
};

// Upper bound on formula length. Real formulas are well under 100 chars; this
// caps token count and parenthesis nesting depth so a pathological record can't
// exhaust the parser's stack (defense in depth, matching the dice-notation cap).
const MAX_EXPRESSION_LENGTH = 1000;

type Token =
  | { kind: "num"; value: number }
  | { kind: "ident"; value: string }
  | { kind: "op"; value: "+" | "-" | "*" | "/" }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "comma" };

const isWhitespace = (ch: string): boolean =>
  ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";

const isIdentifierStart = (ch: string): boolean => /[a-zA-Z_]/.test(ch);

const isIdentifierChar = (ch: string): boolean => /[a-zA-Z0-9_]/.test(ch);

const isOperator = (ch: string): ch is "+" | "-" | "*" | "/" =>
  ch === "+" || ch === "-" || ch === "*" || ch === "/";

/** Scan the number literal starting at `start`; returns the token and the index one past it. */
function scanNumber(expression: string, start: number): { token: Token; end: number } {
  let end = start + 1;
  while (end < expression.length && (isDigit(expression[end]) || expression[end] === ".")) end++;
  const raw = expression.slice(start, end);
  // Reject malformed numbers like "1.2.3" or "1.".
  if (!/^[0-9]+(\.[0-9]+)?$/.test(raw)) {
    throw new Error(`Invalid formula: malformed number "${raw}"`);
  }
  return { token: { kind: "num", value: Number(raw) }, end };
}

/** Scan the identifier (variable or function name) starting at `start`. */
function scanIdentifier(expression: string, start: number): { token: Token; end: number } {
  let end = start + 1;
  while (end < expression.length && isIdentifierChar(expression[end])) end++;
  return { token: { kind: "ident", value: expression.slice(start, end) }, end };
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expression.length) {
    const ch = expression[i];
    if (isWhitespace(ch)) {
      i++;
    } else if (isDigit(ch)) {
      const { token, end } = scanNumber(expression, i);
      tokens.push(token);
      i = end;
    } else if (isIdentifierStart(ch)) {
      const { token, end } = scanIdentifier(expression, i);
      tokens.push(token);
      i = end;
    } else if (isOperator(ch)) {
      tokens.push({ kind: "op", value: ch });
      i++;
    } else if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
    } else if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
    } else if (ch === ",") {
      tokens.push({ kind: "comma" });
      i++;
    } else {
      throw new Error(`Invalid formula: unexpected character "${ch}"`);
    }
  }
  return tokens;
}

/**
 * Parse and evaluate a derived-stat formula.
 *
 * @param expression  Arithmetic expression over the supplied variables.
 * @param variables   Numeric values keyed by identifier (attributes + level).
 * @returns The result floored to an integer, or 0 when the result is not
 *          finite (e.g. division by zero). Throws on any input outside the
 *          grammar: unknown variable/function, wrong arity, or malformed syntax.
 */
export function evaluateFormula(expression: string, variables: Record<string, number>): number {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(`Invalid formula: expression exceeds ${MAX_EXPRESSION_LENGTH} characters`);
  }
  const tokens = tokenize(expression);
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];

  const parseExpr = (): number => {
    let value = parseTerm();
    for (let t = peek(); t?.kind === "op" && (t.value === "+" || t.value === "-"); t = peek()) {
      pos++;
      const rhs = parseTerm();
      value = t.value === "+" ? value + rhs : value - rhs;
    }
    return value;
  };

  const parseTerm = (): number => {
    let value = parseFactor();
    for (let t = peek(); t?.kind === "op" && (t.value === "*" || t.value === "/"); t = peek()) {
      pos++;
      const rhs = parseFactor();
      value = t.value === "*" ? value * rhs : value / rhs;
    }
    return value;
  };

  const parseFactor = (): number => {
    const t = peek();
    if (t === undefined) {
      throw new Error(`Invalid formula: unexpected end of expression "${expression}"`);
    }
    if (t.kind === "op" && (t.value === "+" || t.value === "-")) {
      pos++;
      const operand = parseFactor();
      return t.value === "-" ? -operand : operand;
    }
    if (t.kind === "num") {
      pos++;
      return t.value;
    }
    if (t.kind === "lparen") {
      pos++;
      const value = parseExpr();
      expect("rparen");
      return value;
    }
    if (t.kind === "ident") {
      pos++;
      // Function call?
      if (peek()?.kind === "lparen") {
        const fn = FUNCTIONS[t.value];
        if (!fn) {
          throw new Error(`Invalid formula: unknown function "${t.value}"`);
        }
        pos++; // consume "("
        const args: number[] = [parseExpr()];
        while (peek()?.kind === "comma") {
          pos++;
          args.push(parseExpr());
        }
        expect("rparen");
        if (args.length !== fn.arity) {
          throw new Error(
            `Invalid formula: function "${t.value}" expects ${fn.arity} argument(s), got ${args.length}`,
          );
        }
        return fn.apply(args);
      }
      // Variable reference — must be provided; unknown identifiers fail closed.
      if (!Object.hasOwn(variables, t.value)) {
        throw new Error(`Invalid formula: unknown variable "${t.value}"`);
      }
      return variables[t.value];
    }
    throw new Error(`Invalid formula: unexpected token in "${expression}"`);
  };

  const expect = (kind: Token["kind"]): void => {
    const t = peek();
    if (t?.kind !== kind) {
      throw new Error(`Invalid formula: expected ${kind} in "${expression}"`);
    }
    pos++;
  };

  const result = parseExpr();
  if (pos !== tokens.length) {
    throw new Error(`Invalid formula: unexpected trailing input in "${expression}"`);
  }
  return Number.isFinite(result) ? Math.floor(result) : 0;
}
