import assert from "node:assert/strict";
import { test } from "node:test";
import { createCalculatorTool, evaluateArithmetic } from "../src/tools/calculator.ts";

test("evaluates arithmetic", () => {
  assert.equal(evaluateArithmetic("2+2"), 4);
  assert.equal(evaluateArithmetic("(2 + 3) * 4"), 20);
  assert.equal(evaluateArithmetic("-3 + 5"), 2);
  assert.equal(evaluateArithmetic("2 * -3"), -6);
  assert.equal(evaluateArithmetic("1 / 2"), 0.5);
});

test("the tool rounds binary floating point for display", async () => {
  const tool = createCalculatorTool();
  assert.equal(await tool.execute({ expression: "0.1 + 0.2" }), "0.3");
  assert.equal(await tool.execute({ expression: "(17 * 19) + 8" }), "331");
});

test("rejects anything that is not arithmetic", () => {
  assert.throws(() => evaluateArithmetic("sqrt(81)"), /unexpected character/);
  assert.throws(() => evaluateArithmetic("2^3"), /unexpected character/);
  assert.throws(() => evaluateArithmetic("2 / 0"), /division by zero/);
  assert.throws(() => evaluateArithmetic(""), /empty expression/);
  assert.throws(() => evaluateArithmetic("(2+3"), /missing closing parenthesis/);
});
