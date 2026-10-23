import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main, parseCliArgs } from "../src/cli.ts";
import type { XaiModelOptions } from "../src/agent/model.ts";
import type { ModelResponse } from "../src/types.ts";
import { answer, callTool } from "./helpers.ts";

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
    },
  };
}

test("parseCliArgs joins the task and reads flags", () => {
  const args = parseCliArgs(["--max-steps", "2", "--model", "grok-4.6", "hello", "world"]);
  assert.equal(args.task, "hello world");
  assert.equal(args.maxSteps, 2);
  assert.equal(args.model, "grok-4.6");
  assert.equal(args.help, false);
});

test("help and a missing task do not need an API key", async () => {
  const help = capture();
  assert.equal(await main(["--help"], {}, { io: help.io }), 0);
  assert.match(help.stdout.join(""), /--max-steps/);

  const missing = capture();
  assert.equal(await main([], {}, { io: missing.io, cwd: tmpdir() }), 1);
  assert.match(missing.stderr.join(""), /Usage/);
});

test("a missing key is reported without throwing", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "cli-nokey-"));
  const io = capture();
  const code = await main(["hello"], {}, { cwd, io: io.io });
  assert.equal(code, 1);
  assert.match(io.stderr.join(""), /XAI_API_KEY/);
});

test("an unknown flag is a usage error", async () => {
  const io = capture();
  const code = await main(["--nope", "hello"], {}, { io: io.io });
  assert.equal(code, 1);
  assert.match(io.stderr.join(""), /nope|not recognized|unknown/i);
});

test("the CLI runs the loop, prints the answer, and writes a JSONL trace", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "cli-run-"));
  const io = capture();
  let calls = 0;
  const code = await main(["What is 2+2?"], { XAI_API_KEY: "test-key", XAI_MODEL: "grok-test" }, {
    cwd,
    io: io.io,
    createModel: () => ({
      async complete(request) {
        calls += 1;
        const last = request.messages[request.messages.length - 1];
        if (last?.role === "tool") return answer(`the tool said ${last.content}`);
        return callTool([{ id: "c1", name: "calculator", arguments: '{"expression":"2+2"}' }]);
      },
    }),
  });

  assert.equal(code, 0);
  assert.equal(calls, 2);
  assert.match(io.stdout.join(""), /the tool said 4/);
  assert.match(io.stderr.join(""), /tool call calculator/);
  assert.match(io.stderr.join(""), /model grok-test/);

  const files = readdirSync(path.join(cwd, "traces"));
  assert.equal(files.length, 1);
  assert.match(files[0] ?? "", /\.jsonl$/);
  const events = readFileSync(path.join(cwd, "traces", files[0] ?? ""), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; v: number; status?: string });
  assert.equal(events[0]?.type, "run_start");
  assert.equal(events[0]?.v, 1);
  assert.ok(events.some((event) => event.type === "tool_result"));
  assert.equal(events.at(-1)?.type, "run_end");
  assert.equal(events.at(-1)?.status, "finished");
});

test("--max-steps 1 stops after the tool runs and before a second model call", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "cli-steps-"));
  const io = capture();
  let calls = 0;
  const code = await main(["--max-steps", "1", "add"], { XAI_API_KEY: "test-key" }, {
    cwd,
    io: io.io,
    createModel: () => ({
      async complete(): Promise<ModelResponse> {
        calls += 1;
        return callTool([{ id: "c1", name: "calculator", arguments: '{"expression":"2+2"}' }]);
      },
    }),
  });

  assert.equal(code, 2);
  assert.equal(calls, 1);
  assert.match(io.stdout.join(""), /Stopped after 1 step without a final answer/);
  assert.match(io.stderr.join(""), /status=max_steps/);
  assert.match(io.stderr.join(""), /tool result calculator ok/);
});

test(".env supplies the key, and a real environment variable wins", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "cli-dotenv-"));
  writeFileSync(path.join(cwd, ".env"), 'XAI_API_KEY="from-file"\nXAI_MODEL=grok-4.5\n');
  const seen: XaiModelOptions[] = [];
  const io = capture();
  const code = await main(["hi"], { XAI_MODEL: "from-env" }, {
    cwd,
    io: io.io,
    createModel: (options) => {
      seen.push(options);
      return { async complete() { return answer("ok"); } };
    },
  });
  assert.equal(code, 0);
  assert.equal(seen[0]?.apiKey, "from-file");
  assert.equal(seen[0]?.model, "from-env");
});
