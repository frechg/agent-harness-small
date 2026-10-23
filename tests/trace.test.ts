import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runAgent } from "../src/agent/loop.ts";
import type { Tool } from "../src/tools/types.ts";
import { combineTraces, createConsoleTrace, createJsonlTrace } from "../src/trace/logger.ts";
import { answer, callTool, scriptedModel } from "./helpers.ts";

test("the console summarizes and the JSONL file keeps the full tool output", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "trace-"));
  const file = path.join(dir, "run.jsonl");
  const lines: string[] = [];
  const long = `word ${"x".repeat(500)}`;
  const blob: Tool = {
    name: "blob",
    description: "Return a long string.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute() {
      return long;
    },
  };

  const model = scriptedModel([
    callTool([{ id: "c", name: "blob", arguments: "{}" }]),
    answer("done"),
  ]);

  await runAgent({
    task: "read the blob",
    model,
    modelName: "fake",
    tools: [blob],
    trace: combineTraces([createConsoleTrace((line) => lines.push(line)), createJsonlTrace(file)]),
    maxSteps: 3,
    runId: "trace-1",
  });

  const consoleText = lines.join("\n");
  assert.match(consoleText, /step 1  request/);
  assert.match(consoleText, /prompt=12 completion=8 total=40 reasoning=20/);
  assert.match(consoleText, /tool call blob/);
  assert.match(consoleText, /tool result blob ok/);
  assert.match(consoleText, /…/);

  const events = readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; output?: string; v: number });
  assert.ok(events.every((event) => event.v === 1));
  const toolResult = events.find((event) => event.type === "tool_result");
  assert.equal(toolResult?.output, long);
});
