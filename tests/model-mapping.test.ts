import assert from "node:assert/strict";
import { test } from "node:test";
import { toApiMessages, toApiTools, toModelResponse } from "../src/agent/model.ts";
import type { ChatMessage } from "../src/types.ts";

test("maps our transcript onto the Chat Completions wire format", () => {
  const messages: ChatMessage[] = [
    { role: "system", content: "be brief" },
    { role: "user", content: "2+2" },
    {
      role: "assistant",
      content: null,
      toolCalls: [{ id: "call_1", name: "calculator", arguments: '{"expression":"2+2"}' }],
      reasoningContent: "add them",
    },
    { role: "tool", toolCallId: "call_1", content: "4" },
  ];

  assert.deepEqual(toApiMessages(messages), [
    { role: "system", content: "be brief" },
    { role: "user", content: "2+2" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "calculator", arguments: '{"expression":"2+2"}' },
        },
      ],
      reasoning_content: "add them",
    },
    { role: "tool", tool_call_id: "call_1", content: "4" },
  ]);
});

test("nests tools under function, which is the Chat Completions shape", () => {
  const tools = toApiTools([
    {
      name: "calculator",
      description: "add",
      parameters: {
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"],
        additionalProperties: false,
      },
    },
  ]);
  assert.equal(tools[0]?.type, "function");
  const fn = tools[0]?.function as { name: string };
  assert.equal(fn.name, "calculator");
  assert.equal("name" in (tools[0] ?? {}), false);
});

test("reads tool calls, reasoning text, and token usage from a completion", () => {
  const response = toModelResponse({
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          content: null,
          reasoning_content: "thinking",
          tool_calls: [
            { id: "call_1", function: { name: "calculator", arguments: '{"expression":"1+1"}' } },
          ],
        },
      },
    ],
    usage: {
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 30,
      completion_tokens_details: { reasoning_tokens: 12 },
    },
  });

  assert.equal(response.finishReason, "tool_calls");
  assert.equal(response.reasoningContent, "thinking");
  assert.deepEqual(response.toolCalls, [
    { id: "call_1", name: "calculator", arguments: '{"expression":"1+1"}' },
  ]);
  assert.deepEqual(response.usage, {
    promptTokens: 11,
    completionTokens: 7,
    totalTokens: 30,
    reasoningTokens: 12,
  });
});

test("a completion with no choices is an error", () => {
  assert.throws(() => toModelResponse({ choices: [] }), /no choices/);
});
