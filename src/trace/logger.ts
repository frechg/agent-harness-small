/**
 * Two views of the same events.
 *
 * stderr is for a person watching a run. The JSONL file is for a later viewer:
 * one JSON object per line, every object carrying `"v": 1`. The answer itself
 * is not printed here. The CLI writes that to stdout.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { TraceEvent, TraceSink, TokenUsage } from "../types.js";

export function createConsoleTrace(
  write: (line: string) => void = (line) => {
    process.stderr.write(`${line}\n`);
  },
): TraceSink {
  return {
    record(event) {
      write(formatEvent(event));
    },
  };
}

export function createJsonlTrace(filePath: string): TraceSink {
  mkdirSync(path.dirname(filePath), { recursive: true });
  return {
    record(event) {
      appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
    },
  };
}

export function combineTraces(sinks: readonly TraceSink[]): TraceSink {
  return {
    record(event) {
      for (const sink of sinks) sink.record(event);
    },
  };
}

/** In-memory sink for tests and for anything that wants the events as data. */
export class MemoryTrace implements TraceSink {
  readonly events: TraceEvent[] = [];

  record(event: TraceEvent): void {
    this.events.push(event);
  }
}

function formatEvent(event: TraceEvent): string {
  switch (event.type) {
    case "run_start":
      return [
        `run ${event.runId}`,
        `model ${event.model}   maxSteps ${event.maxSteps}`,
        `task ${oneLine(event.task, 200)}`,
      ].join("\n");
    case "model_request":
      return [
        "",
        `step ${event.step}  request   messages=${event.messageCount} [${event.messageRoles.join(", ")}]`,
        `         tools=[${event.toolNames.join(", ")}]`,
      ].join("\n");
    case "model_response": {
      const text = event.content ? `\n         ${oneLine(event.content, 400)}` : "";
      return `step ${event.step}  response  finish=${event.finishReason ?? "null"} ${formatUsage(event.usage)} ${event.durationMs}ms${text}`;
    }
    case "tool_call":
      return `step ${event.step}  tool call ${event.name} ${oneLine(event.arguments, 300)}`;
    case "tool_result": {
      const mark = event.ok ? "ok" : "error";
      return `step ${event.step}  tool result ${event.name} ${mark} ${event.durationMs}ms\n         ${oneLine(event.output, 400)}`;
    }
    case "run_end": {
      const detail = event.status === "error" ? ` error=${oneLine(event.error, 200)}` : "";
      return `\nrun end status=${event.status} steps=${event.steps}${detail}`;
    }
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

function formatUsage(usage: TokenUsage | null): string {
  if (!usage) return "tokens=n/a";
  const reasoning =
    usage.reasoningTokens !== undefined ? ` reasoning=${usage.reasoningTokens}` : "";
  return `prompt=${usage.promptTokens} completion=${usage.completionTokens} total=${usage.totalTokens}${reasoning}`;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}…`;
}
