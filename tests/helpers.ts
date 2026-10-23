import type { ModelClient, ModelRequest, ModelResponse, ToolCall } from "../src/types.ts";

/** A model that returns a fixed script of responses and records what it was sent. */
export function scriptedModel(
  responses: ModelResponse[],
): ModelClient & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    requests,
    async complete(request) {
      requests.push(request);
      const next = responses[requests.length - 1];
      if (!next) throw new Error(`no scripted response for call ${requests.length}`);
      return next;
    },
  };
}

export function answer(content: string, extra: Partial<ModelResponse> = {}): ModelResponse {
  return {
    content,
    toolCalls: [],
    finishReason: "stop",
    usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
    reasoningContent: null,
    ...extra,
  };
}

export function callTool(
  calls: ToolCall[],
  extra: Partial<ModelResponse> = {},
): ModelResponse {
  return {
    content: null,
    toolCalls: calls,
    finishReason: "tool_calls",
    usage: { promptTokens: 12, completionTokens: 8, totalTokens: 40, reasoningTokens: 20 },
    reasoningContent: null,
    ...extra,
  };
}
