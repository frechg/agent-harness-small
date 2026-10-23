/**
 * The only file that knows how to talk to xAI.
 *
 * We use the official OpenAI client against the OpenAI-compatible Chat
 * Completions endpoint (https://api.x.ai/v1). Default model is grok-4.7,
 * the flagship on https://docs.x.ai/developers/models as of October 2026.
 *
 * Tool calls use the Chat Completions shape, the same one in xAI's tool-loop
 * example: tools are `{ type: "function", function: { name, description,
 * parameters } }`, and a result is `{ role: "tool", tool_call_id, content }`.
 * See https://docs.x.ai/developers/model-capabilities/text/structured-outputs
 *
 * The Responses API (`/v1/responses`) is the newer endpoint. It stores the
 * conversation server-side and uses a different tool shape. Stage 1 stays on
 * Chat Completions so this process owns the transcript. That ownership is the
 * thing the loop is teaching. Switching later means changing this file and
 * the loop together, not this file alone.
 */

import OpenAI from "openai";
import type {
  ChatMessage,
  ModelClient,
  ModelResponse,
  ToolCall,
  ToolDefinition,
  TokenUsage,
} from "../types.js";

export interface XaiModelOptions {
  apiKey: string;
  model: string;
  baseURL: string;
  timeoutMs: number;
}

export function createXaiModel(options: XaiModelOptions): ModelClient {
  // maxRetries is 0 so a 500 or a timeout fails the run instead of disappearing
  // into the client's own retry loop. The harness loop is the one we want to see.
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    timeout: options.timeoutMs,
    maxRetries: 0,
  });

  return {
    async complete(request) {
      // Plain objects, not SDK classes. The cast keeps reasoning_content, which
      // the SDK's message type does not list, on the JSON body we send.
      const messages = toApiMessages(
        request.messages,
      ) as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[];
      const tools = request.tools.length
        ? (toApiTools(request.tools) as unknown as OpenAI.Chat.Completions.ChatCompletionTool[])
        : undefined;

      const completion = await client.chat.completions.create({
        model: options.model,
        messages,
        tools,
        // The API default is true. Several tool calls can come back in one step.
        parallel_tool_calls: true,
      });
      return toModelResponse(completion);
    },
  };
}

/** Our transcript → the wire messages. */
export function toApiMessages(messages: readonly ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    switch (message.role) {
      case "system":
      case "user":
        return { role: message.role, content: message.content };
      case "tool":
        return {
          role: "tool",
          tool_call_id: message.toolCallId,
          content: message.content,
        };
      case "assistant": {
        const api: Record<string, unknown> = {
          role: "assistant",
          content: message.content,
        };
        if (message.toolCalls && message.toolCalls.length > 0) {
          api.tool_calls = message.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          }));
        }
        // Send the reasoning text back with the tool call when the model gave us one.
        if (message.reasoningContent) {
          api.reasoning_content = message.reasoningContent;
        }
        return api;
      }
      default: {
        const unreachable: never = message;
        return unreachable;
      }
    }
  });
}

/** Our tool list → the nested `function` object Chat Completions expects. */
export function toApiTools(tools: readonly ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * The subset of a Chat Completion this harness reads. The SDK object is a
 * superset; tests pass a plain fixture.
 */
export interface ChatCompletionLike {
  choices: Array<{
    finish_reason?: string | null;
    message: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        id: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }> | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    } | null;
  } | null;
}

export function toModelResponse(completion: ChatCompletionLike): ModelResponse {
  const choice = completion.choices[0];
  if (!choice) throw new Error("model returned no choices");

  const message = choice.message;
  const toolCalls: ToolCall[] = [];
  for (const call of message.tool_calls ?? []) {
    const name = call.function?.name;
    if (!name) throw new Error("model returned a tool call without a function name");
    toolCalls.push({
      id: call.id,
      name,
      arguments: call.function?.arguments ?? "",
    });
  }

  return {
    content: message.content ?? null,
    toolCalls,
    finishReason: choice.finish_reason ?? null,
    usage: readUsage(completion.usage),
    reasoningContent: typeof message.reasoning_content === "string" ? message.reasoning_content : null,
  };
}

function readUsage(usage: ChatCompletionLike["usage"]): TokenUsage | null {
  if (!usage) return null;
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
    ...(typeof reasoning === "number" ? { reasoningTokens: reasoning } : {}),
  };
}
