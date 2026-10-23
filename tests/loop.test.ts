import assert from "node:assert/strict";
import { test } from "node:test";
import { runAgent } from "../src/agent/loop.ts";
import { createCalculatorTool } from "../src/tools/calculator.ts";
import type { Tool } from "../src/tools/types.ts";
import { MemoryTrace } from "../src/trace/logger.ts";
import type { ChatMessage } from "../src/types.ts";
import { answer, callTool, scriptedModel } from "./helpers.ts";

const echo: Tool = {
  name: "echo",
  description: "Repeat text.",
  parameters: {
    type: "object",
    properties: { text: { type: "string", description: "Text to repeat." } },
    required: ["text"],
    additionalProperties: false,
  },
  execute(args) {
    if (args === null || typeof args !== "object" || !("text" in args)) {
      throw new Error('echo needs "text"');
    }
    return `echo:${String((args as { text: unknown }).text)}`;
  },
};

const fail: Tool = {
  name: "fail",
  description: "Always throws.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute() {
    throw new Error("boom");
  },
};

test("a model that does not call a tool finishes in one step", async () => {
  const model = scriptedModel([answer("hello")]);
  const trace = new MemoryTrace();
  const result = await runAgent({
    task: "say hello",
    model,
    modelName: "fake",
    tools: [echo],
    trace,
    maxSteps: 4,
    runId: "run-1",
  });

  assert.equal(result.status, "finished");
  assert.equal(result.answer, "hello");
  assert.equal(result.steps, 1);
  assert.equal(model.requests.length, 1);
  assert.equal(result.messages.at(-1)?.role, "assistant");
  assert.equal(result.messages.at(-1)?.content, "hello");
  assert.deepEqual(
    trace.events.map((event) => event.type),
    ["run_start", "model_request", "model_response", "run_end"],
  );
  const end = trace.events.at(-1);
  assert.equal(end?.type, "run_end");
  if (end?.type === "run_end") assert.equal(end.status, "finished");
});

test("tool results are appended before the next model call", async () => {
  const model = scriptedModel([
    callTool([{ id: "call_1", name: "calculator", arguments: '{"expression":"(17 * 19) + 8"}' }], {
      reasoningContent: "I should use the calculator.",
    }),
    answer("331"),
  ]);
  const trace = new MemoryTrace();
  const result = await runAgent({
    task: "What is (17 * 19) + 8?",
    model,
    modelName: "fake",
    tools: [createCalculatorTool()],
    trace,
    maxSteps: 4,
    runId: "run-calc",
  });

  assert.equal(result.status, "finished");
  assert.equal(result.answer, "331");
  assert.equal(result.steps, 2);

  const second = model.requests[1]?.messages ?? [];
  const assistant = second[2];
  const toolMessage = second[3];
  assert.equal(assistant?.role, "assistant");
  if (assistant?.role === "assistant") {
    assert.equal(assistant.toolCalls?.[0]?.id, "call_1");
    assert.equal(assistant.reasoningContent, "I should use the calculator.");
  }
  assert.equal(toolMessage?.role, "tool");
  if (toolMessage?.role === "tool") {
    assert.equal(toolMessage.toolCallId, "call_1");
    assert.equal(toolMessage.content, "331");
  }

  const response = trace.events.find((event) => event.type === "model_response");
  assert.equal(response?.type, "model_response");
  if (response?.type === "model_response") {
    assert.equal(response.usage?.reasoningTokens, 20);
  }
});

test("several tool calls in one step all run, in order, before the next request", async () => {
  const seen: string[] = [];
  const marker: Tool = {
    name: "marker",
    description: "Record a label.",
    parameters: {
      type: "object",
      properties: { label: { type: "string" } },
      required: ["label"],
      additionalProperties: false,
    },
    execute(args) {
      const label = String((args as { label: string }).label);
      seen.push(label);
      return label;
    },
  };
  const model = scriptedModel([
    callTool([
      { id: "a", name: "marker", arguments: '{"label":"first"}' },
      { id: "b", name: "marker", arguments: '{"label":"second"}' },
    ]),
    answer("both"),
  ]);

  const result = await runAgent({
    task: "mark twice",
    model,
    modelName: "fake",
    tools: [marker],
    trace: new MemoryTrace(),
    maxSteps: 3,
    runId: "run-parallel",
  });

  assert.deepEqual(seen, ["first", "second"]);
  assert.equal(result.answer, "both");
  const roles = (model.requests[1]?.messages ?? []).map((message: ChatMessage) => message.role);
  assert.deepEqual(roles, ["system", "user", "assistant", "tool", "tool"]);
});

test("a thrown tool is returned to the model and the loop continues", async () => {
  const model = scriptedModel([
    callTool([{ id: "c", name: "fail", arguments: "{}" }]),
    answer("the tool failed"),
  ]);
  const trace = new MemoryTrace();
  const result = await runAgent({
    task: "try the failing tool",
    model,
    modelName: "fake",
    tools: [fail],
    trace,
    maxSteps: 3,
    runId: "run-fail",
  });

  assert.equal(result.status, "finished");
  assert.equal(result.answer, "the tool failed");
  const toolMessage = model.requests[1]?.messages.at(-1);
  assert.equal(toolMessage?.role, "tool");
  if (toolMessage?.role === "tool") assert.equal(toolMessage.content, "Error: boom");

  const toolResult = trace.events.find((event) => event.type === "tool_result");
  assert.equal(toolResult?.type, "tool_result");
  if (toolResult?.type === "tool_result") assert.equal(toolResult.ok, false);
});

test("an unknown tool and bad JSON become tool errors", async () => {
  const model = scriptedModel([
    callTool([
      { id: "u", name: "missing", arguments: "{}" },
      { id: "j", name: "echo", arguments: "{" },
    ]),
    answer("recovered"),
  ]);
  const result = await runAgent({
    task: "break the tools",
    model,
    modelName: "fake",
    tools: [echo],
    trace: new MemoryTrace(),
    maxSteps: 3,
    runId: "run-bad",
  });

  assert.equal(result.answer, "recovered");
  const tools = (model.requests[1]?.messages ?? []).filter((message) => message.role === "tool");
  assert.equal(tools.length, 2);
  assert.match(tools[0]?.content ?? "", /unknown tool "missing"/);
  assert.match(tools[1]?.content ?? "", /not valid JSON/);
});

test("max steps stops after the budget, even if the last response called a tool", async () => {
  const model = scriptedModel([
    callTool([{ id: "c1", name: "echo", arguments: '{"text":"one"}' }]),
    callTool([{ id: "c2", name: "echo", arguments: '{"text":"two"}' }]),
    answer("this should not be requested"),
  ]);
  const trace = new MemoryTrace();
  const result = await runAgent({
    task: "keep going",
    model,
    modelName: "fake",
    tools: [echo],
    trace,
    maxSteps: 2,
    runId: "run-limit",
  });

  assert.equal(result.status, "max_steps");
  assert.equal(result.answer, null);
  assert.equal(result.steps, 2);
  assert.equal(model.requests.length, 2);
  const toolMessages = result.messages.filter((message) => message.role === "tool");
  assert.deepEqual(
    toolMessages.map((message) => message.content),
    ["echo:one", "echo:two"],
  );
  const end = trace.events.at(-1);
  assert.equal(end?.type, "run_end");
  if (end?.type === "run_end") assert.equal(end.status, "max_steps");
});

test("a model failure is recorded and rethrown", async () => {
  const trace = new MemoryTrace();
  const model = scriptedModel([callTool([{ id: "c", name: "echo", arguments: '{"text":"hi"}' }])]);
  model.complete = async () => {
    throw new Error("network down");
  };

  await assert.rejects(
    () =>
      runAgent({
        task: "hi",
        model,
        modelName: "fake",
        tools: [echo],
        trace,
        maxSteps: 2,
        runId: "run-net",
      }),
    /network down/,
  );

  const end = trace.events.at(-1);
  assert.equal(end?.type, "run_end");
  if (end?.type === "run_end" && end.status === "error") {
    assert.equal(end.error, "network down");
    assert.equal(end.steps, 0);
  } else {
    assert.fail("expected an error run_end");
  }
});

test("empty task and a bad step budget are rejected before a run starts", async () => {
  const trace = new MemoryTrace();
  const model = scriptedModel([]);
  await assert.rejects(
    () =>
      runAgent({
        task: "   ",
        model,
        modelName: "fake",
        tools: [],
        trace,
        maxSteps: 1,
        runId: "nope",
      }),
    /task is empty/,
  );
  await assert.rejects(
    () =>
      runAgent({
        task: "hi",
        model,
        modelName: "fake",
        tools: [],
        trace,
        maxSteps: 0,
        runId: "nope",
      }),
    /maxSteps/,
  );
  assert.equal(trace.events.length, 0);
});
