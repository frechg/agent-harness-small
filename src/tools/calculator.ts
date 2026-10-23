import { expectRecord, expectString } from "./args.js";
import type { Tool } from "./types.js";

/**
 * Arithmetic only. A hand-written parser, not `eval`, so a surprising
 * expression fails as a tool error instead of running as code.
 *
 * Grammar:
 *   expression = term (("+" | "-") term)*
 *   term       = factor (("*" | "/") factor)*
 *   factor     = number | "(" expression ")" | "-" factor | "+" factor
 */

export function createCalculatorTool(): Tool {
  return {
    name: "calculator",
    description:
      "Evaluate an arithmetic expression. Supports numbers, parentheses, and + - * /. Does not support variables or functions.",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: 'Example: "(17 * 19) + 8"',
        },
      },
      required: ["expression"],
      additionalProperties: false,
    },
    execute(args) {
      const expression = expectString(expectRecord(args), "expression");
      return formatNumber(evaluateArithmetic(expression));
    },
  };
}

export function evaluateArithmetic(expression: string): number {
  const cursor: Cursor = { tokens: tokenize(expression), index: 0 };
  if (cursor.tokens.length === 0) throw new Error("empty expression");
  const value = parseExpression(cursor);
  if (cursor.index !== cursor.tokens.length) {
    throw new Error("unexpected trailing input");
  }
  return value;
}

/**
 * Round to 12 decimal places so 0.1 + 0.2 comes back as 0.3.
 * This is a display choice, not a decimal type. Huge integers can still drift.
 */
function formatNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("result is not a finite number");
  const rounded = Math.round(value * 1e12) / 1e12;
  return String(rounded);
}

type Token =
  | { type: "number"; value: number }
  | { type: "op"; value: "+" | "-" | "*" | "/" }
  | { type: "lparen" }
  | { type: "rparen" };

interface Cursor {
  tokens: Token[];
  index: number;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === undefined) break;
    if (ch === " " || ch === "\t" || ch === "\n") {
      i += 1;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ type: "op", value: ch });
      i += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen" });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen" });
      i += 1;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      const start = i;
      i += 1;
      while (i < input.length) {
        const next = input[i];
        if (next !== undefined && ((next >= "0" && next <= "9") || next === ".")) i += 1;
        else break;
      }
      const raw = input.slice(start, i);
      if (!/^(?:\d+\.\d+|\d+|\.\d+)$/.test(raw)) {
        throw new Error(`invalid number "${raw}"`);
      }
      tokens.push({ type: "number", value: Number(raw) });
      continue;
    }
    throw new Error(`unexpected character "${ch}"`);
  }
  return tokens;
}

function parseExpression(cursor: Cursor): number {
  let value = parseTerm(cursor);
  while (peekOp(cursor, "+") || peekOp(cursor, "-")) {
    const op = takeOp(cursor);
    const right = parseTerm(cursor);
    value = op === "+" ? value + right : value - right;
  }
  return value;
}

function parseTerm(cursor: Cursor): number {
  let value = parseFactor(cursor);
  while (peekOp(cursor, "*") || peekOp(cursor, "/")) {
    const op = takeOp(cursor);
    const right = parseFactor(cursor);
    if (op === "/" && right === 0) throw new Error("division by zero");
    value = op === "*" ? value * right : value / right;
  }
  return value;
}

function parseFactor(cursor: Cursor): number {
  const token = cursor.tokens[cursor.index];
  if (!token) throw new Error("unexpected end of expression");
  if (token.type === "op" && (token.value === "-" || token.value === "+")) {
    cursor.index += 1;
    const value = parseFactor(cursor);
    return token.value === "-" ? -value : value;
  }
  if (token.type === "number") {
    cursor.index += 1;
    return token.value;
  }
  if (token.type === "lparen") {
    cursor.index += 1;
    const value = parseExpression(cursor);
    const close = cursor.tokens[cursor.index];
    if (!close || close.type !== "rparen") throw new Error("missing closing parenthesis");
    cursor.index += 1;
    return value;
  }
  throw new Error("expected a number or '('");
}

function peekOp(cursor: Cursor, op: "+" | "-" | "*" | "/"): boolean {
  const token = cursor.tokens[cursor.index];
  return token?.type === "op" && token.value === op;
}

function takeOp(cursor: Cursor): "+" | "-" | "*" | "/" {
  const token = cursor.tokens[cursor.index];
  if (!token || token.type !== "op") throw new Error("expected an operator");
  cursor.index += 1;
  return token.value;
}
