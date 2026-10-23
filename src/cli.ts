/**
 * CLI entry. `npm run agent -- "your task"` and `node dist/cli.js "your task"`
 * both land here. The answer goes to stdout. The step trace goes to stderr
 * and to a JSONL file.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { runAgent, createRunId } from "./agent/loop.js";
import { createXaiModel, type XaiModelOptions } from "./agent/model.js";
import { loadConfig, loadEnvFile, parsePositiveInt, requireApiKey, type AppConfig } from "./config.js";
import { createDefaultTools } from "./tools/index.js";
import { combineTraces, createConsoleTrace, createJsonlTrace } from "./trace/logger.js";
import type { ModelClient } from "./types.js";

const HELP = `Usage: npm run agent -- [options] "task"

Run one agent loop: send the task to Grok, execute any tool calls, and repeat
until the model answers or the step limit is hit.

Options:
  --max-steps <n>      Model calls before stopping (default 8, or AGENT_MAX_STEPS)
  --model <name>       Model name (default grok-4.7, or XAI_MODEL)
  --trace-dir <dir>    Directory for the JSONL trace (default traces)
  --scratch-dir <dir>  Scratchpad directory (default scratch)
  -h, --help           Show this help

The final answer is printed to stdout. The step trace goes to stderr and to
a JSONL file. This help does not need an API key. A real run needs
XAI_API_KEY (see .env.example).

Examples:
  npm run agent -- "What is (17 * 19) + 8? Use the calculator."
  npm run agent -- --max-steps 1 "Fetch https://example.com and summarize it"
`;

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface MainOptions {
  cwd?: string;
  io?: CliIO;
  /**
   * Tests pass a fake model. The real CLI uses the xAI client.
   * A later stage can pass a planner client the same way.
   */
  createModel?: (options: XaiModelOptions) => ModelClient;
}

export interface CliArgs {
  help: boolean;
  task: string;
  maxSteps?: number;
  model?: string;
  traceDir?: string;
  scratchDir?: string;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
      "max-steps": { type: "string" },
      model: { type: "string" },
      "trace-dir": { type: "string" },
      "scratch-dir": { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });

  let maxSteps: number | undefined;
  if (values["max-steps"] !== undefined) {
    maxSteps = parsePositiveInt(values["max-steps"], Number.NaN, "--max-steps");
    if (!Number.isInteger(maxSteps)) {
      throw new Error("--max-steps must be a positive integer");
    }
  }

  return {
    help: values.help ?? false,
    task: positionals.join(" ").trim(),
    ...(maxSteps !== undefined ? { maxSteps } : {}),
    ...(values.model !== undefined ? { model: values.model } : {}),
    ...(values["trace-dir"] !== undefined ? { traceDir: values["trace-dir"] } : {}),
    ...(values["scratch-dir"] !== undefined ? { scratchDir: values["scratch-dir"] } : {}),
  };
}

export async function main(
  argv: string[],
  env: NodeJS.ProcessEnv,
  options: MainOptions = {},
): Promise<number> {
  const io = options.io ?? defaultIO;
  const cwd = options.cwd ?? process.cwd();

  try {
    const args = parseCliArgs(argv);
    if (args.help) {
      io.stdout(HELP);
      return 0;
    }
    if (args.task === "") {
      io.stderr(HELP);
      return 1;
    }

    loadEnvFile(path.join(cwd, ".env"), env);
    const config = applyArgs(loadConfig(env), args);
    const apiKey = requireApiKey(config);
    const runId = createRunId();
    const tracePath = path.resolve(cwd, config.traceDir, `${runId}.jsonl`);
    const trace = combineTraces([
      createConsoleTrace((line) => io.stderr(`${line}\n`)),
      createJsonlTrace(tracePath),
    ]);

    try {
      const createModel = options.createModel ?? createXaiModel;
      const result = await runAgent({
        task: args.task,
        modelName: config.model,
        model: createModel({
          apiKey,
          model: config.model,
          baseURL: config.baseURL,
          timeoutMs: config.timeoutMs,
        }),
        tools: createDefaultTools({
          scratchDir: path.resolve(cwd, config.scratchDir),
        }),
        trace,
        maxSteps: config.maxSteps,
        runId,
      });

      if (result.status === "finished") {
        const answer = result.answer ?? "";
        io.stdout(answer.endsWith("\n") ? answer : `${answer}\n`);
        return 0;
      }
      const noun = result.steps === 1 ? "step" : "steps";
      io.stdout(`Stopped after ${result.steps} ${noun} without a final answer.\n`);
      return 2;
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    } finally {
      io.stderr(`trace ${tracePath}\n`);
    }
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function applyArgs(config: AppConfig, args: CliArgs): AppConfig {
  return {
    ...config,
    ...(args.maxSteps !== undefined ? { maxSteps: args.maxSteps } : {}),
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.traceDir !== undefined ? { traceDir: args.traceDir } : {}),
    ...(args.scratchDir !== undefined ? { scratchDir: args.scratchDir } : {}),
  };
}

const defaultIO: CliIO = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  main(process.argv.slice(2), process.env).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
