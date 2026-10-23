/**
 * Shared nouns for the harness.
 *
 * Later stages (planner/worker, a parallel orchestrator, a trace viewer, evals)
 * should be able to import these without knowing how a tool is implemented or
 * which HTTP call talks to the model. The trace schema is versioned so a viewer
 * can reject files it does not understand.
 */

/** JSON Schema for a tool's arguments. xAI requires the root to be an object. */
export interface ToolParameters {
  type: "object";
  properties: Record<string, object>;
  required?: string[];
  additionalProperties?: boolean;
}

/** What the model is allowed to call. The registry turns this into a real function. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameters;
}

/** One function call requested by the model. `arguments` is still a JSON string. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}

/**
 * The transcript the loop owns. Field names are camelCase on purpose.
 * `src/agent/model.ts` is the only place that translates them to the
 * snake_case Chat Completions wire format.
 */
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      toolCalls?: ToolCall[];
      /**
       * Reasoning models may require this text to be sent back with the tool
       * call. We keep it whenever the API returns it.
       */
      reasoningContent?: string;
    }
  | { role: "tool"; toolCallId: string; content: string };

export interface ModelRequest {
  messages: ChatMessage[];
  tools: ToolDefinition[];
}

export interface ModelResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string | null;
  usage: TokenUsage | null;
  reasoningContent: string | null;
}

/**
 * The loop's only view of a model. Tests pass a script. A later planner and
 * worker can be two clients, or one client with two prompts.
 */
export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export interface AgentResult {
  /** `finished` means the model stopped calling tools. `max_steps` means we did. */
  status: "finished" | "max_steps";
  /** Null when we hit the step limit before a final answer. */
  answer: string | null;
  /** How many model calls were made. */
  steps: number;
  /** Full transcript, including the final assistant message when there is one. */
  messages: ChatMessage[];
  runId: string;
}

interface TraceBase {
  v: 1;
  ts: string;
  runId: string;
}

export type TraceEvent =
  | (TraceBase & {
      type: "run_start";
      model: string;
      maxSteps: number;
      task: string;
    })
  | (TraceBase & {
      type: "model_request";
      step: number;
      messageCount: number;
      messageRoles: string[];
      toolNames: string[];
    })
  | (TraceBase & {
      type: "model_response";
      step: number;
      finishReason: string | null;
      content: string | null;
      toolCalls: Array<{ id: string; name: string; arguments: string }>;
      usage: TokenUsage | null;
      durationMs: number;
    })
  | (TraceBase & {
      type: "tool_call";
      step: number;
      toolCallId: string;
      name: string;
      arguments: string;
    })
  | (TraceBase & {
      type: "tool_result";
      step: number;
      toolCallId: string;
      name: string;
      ok: boolean;
      output: string;
      durationMs: number;
    })
  | (TraceBase & {
      type: "run_end";
      steps: number;
      answer: string | null;
      status: "finished" | "max_steps";
    })
  | (TraceBase & {
      type: "run_end";
      steps: number;
      answer: null;
      status: "error";
      error: string;
    });

/** Anything that can accept trace events. The console and the JSONL file are two sinks. */
export interface TraceSink {
  record(event: TraceEvent): void;
}
