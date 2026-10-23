/**
 * The agent loop.
 *
 *   1. Send the transcript and the tool definitions.
 *   2. If the model returns no tool calls, that text is the answer.
 *   3. Otherwise append the assistant message, run every tool call, and append
 *      one tool message per call. A thrown tool becomes "Error: ..." and the
 *      loop continues. The model decides what to do with the failure.
 *   4. Stop if that was the last allowed model call.
 *
 * One step is one model call. Tool calls from that response always run, even
 * when no step remains afterwards. With `--max-steps 1` the model can call a
 * tool and then the loop stops before the model sees the result. That is
 * intentional: the limit is on model calls, and the trace shows the unused result.
 *
 * Tool calls in a single step are independent. They run in order so the trace
 * is deterministic. A later parallel stage can change that without changing
 * the transcript shape.
 */

import { ToolRegistry } from "../tools/registry.js";
import type { Tool } from "../tools/types.js";
import type {
  AgentResult,
  ChatMessage,
  ModelClient,
  ModelResponse,
  TraceSink,
} from "../types.js";

export const DEFAULT_SYSTEM_PROMPT = [
  "You are a single agent in a small harness. The conversation is stateless on the server, so this transcript is your only memory.",
  "Call a tool when it will make the answer more reliable. The tool definitions are the source of truth for names and arguments.",
  'When a tool result starts with "Error:", read it and either try a different approach or explain the failure. Do not invent tool results.',
  "When you can answer, reply with normal text and do not call a tool.",
].join("\n");

export interface RunAgentInput {
  task: string;
  model: ModelClient;
  /** Recorded on the trace. The client already knows which model it calls. */
  modelName: string;
  tools: readonly Tool[];
  trace: TraceSink;
  maxSteps: number;
  runId?: string;
  systemPrompt?: string;
}

export async function runAgent(input: RunAgentInput): Promise<AgentResult> {
  if (input.task.trim() === "") throw new Error("task is empty");
  if (!Number.isInteger(input.maxSteps) || input.maxSteps < 1) {
    throw new Error(`maxSteps must be a positive integer, got ${String(input.maxSteps)}`);
  }

  const runId = input.runId ?? createRunId();
  const registry = new ToolRegistry(input.tools);
  const messages: ChatMessage[] = [
    { role: "system", content: input.systemPrompt ?? DEFAULT_SYSTEM_PROMPT },
    { role: "user", content: input.task },
  ];

  input.trace.record({
    v: 1,
    type: "run_start",
    ts: timestamp(),
    runId,
    model: input.modelName,
    maxSteps: input.maxSteps,
    task: input.task,
  });

  let completedSteps = 0;
  try {
    for (let step = 1; step <= input.maxSteps; step += 1) {
      const tools = registry.definitions();
      input.trace.record({
        v: 1,
        type: "model_request",
        ts: timestamp(),
        runId,
        step,
        messageCount: messages.length,
        messageRoles: messages.map((message) => message.role),
        toolNames: tools.map((tool) => tool.name),
      });

      const started = Date.now();
      // Copy the array so a client that pushes cannot change the transcript.
      // The message objects themselves are shared and must not be mutated.
      const response = await input.model.complete({ messages: [...messages], tools });
      completedSteps = step;

      input.trace.record({
        v: 1,
        type: "model_response",
        ts: timestamp(),
        runId,
        step,
        finishReason: response.finishReason,
        content: response.content,
        toolCalls: response.toolCalls.map((call) => ({
          id: call.id,
          name: call.name,
          arguments: call.arguments,
        })),
        usage: response.usage,
        durationMs: Date.now() - started,
      });

      if (response.toolCalls.length === 0) {
        return finish(input.trace, messages, response, step, runId);
      }

      // The assistant message has to sit immediately before its tool results,
      // and each result's id has to match a call id. The API rejects a tool
      // message that arrives on its own.
      messages.push({
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
        ...(response.reasoningContent ? { reasoningContent: response.reasoningContent } : {}),
      });

      for (const call of response.toolCalls) {
        input.trace.record({
          v: 1,
          type: "tool_call",
          ts: timestamp(),
          runId,
          step,
          toolCallId: call.id,
          name: call.name,
          arguments: call.arguments,
        });

        const toolStarted = Date.now();
        let output: string;
        let ok = true;
        try {
          output = await registry.call(call.name, call.arguments);
        } catch (error) {
          ok = false;
          output = formatToolError(error);
        }

        messages.push({ role: "tool", toolCallId: call.id, content: output });
        input.trace.record({
          v: 1,
          type: "tool_result",
          ts: timestamp(),
          runId,
          step,
          toolCallId: call.id,
          name: call.name,
          ok,
          output,
          durationMs: Date.now() - toolStarted,
        });
      }
    }

    const result: AgentResult = {
      status: "max_steps",
      answer: null,
      steps: input.maxSteps,
      messages,
      runId,
    };
    input.trace.record({
      v: 1,
      type: "run_end",
      ts: timestamp(),
      runId,
      status: "max_steps",
      steps: input.maxSteps,
      answer: null,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      input.trace.record({
        v: 1,
        type: "run_end",
        ts: timestamp(),
        runId,
        status: "error",
        steps: completedSteps,
        answer: null,
        error: message,
      });
    } catch {
      // A broken trace file must not hide the failure that ended the run.
    }
    throw error;
  }
}

export function createRunId(date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${suffix}`;
}

function finish(
  trace: TraceSink,
  messages: ChatMessage[],
  response: ModelResponse,
  step: number,
  runId: string,
): AgentResult {
  const answer = response.content ?? "";
  messages.push({
    role: "assistant",
    content: answer,
    ...(response.reasoningContent ? { reasoningContent: response.reasoningContent } : {}),
  });
  const result: AgentResult = {
    status: "finished",
    answer,
    steps: step,
    messages,
    runId,
  };
  trace.record({
    v: 1,
    type: "run_end",
    ts: timestamp(),
    runId,
    status: "finished",
    steps: step,
    answer,
  });
  return result;
}

function formatToolError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Error: ${message}`;
}

function timestamp(): string {
  return new Date().toISOString();
}
