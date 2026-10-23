import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_MODEL, loadConfig, loadEnvFile, parsePositiveInt } from "../src/config.ts";

test("defaults to the current flagship when XAI_MODEL is unset", () => {
  const config = loadConfig({});
  assert.equal(config.model, DEFAULT_MODEL);
  assert.equal(config.model, "grok-4.7");
  assert.equal(config.baseURL, "https://api.x.ai/v1");
  assert.equal(config.maxSteps, 8);
  assert.equal(config.apiKey, undefined);
});

test("environment overrides the defaults", () => {
  const config = loadConfig({
    XAI_API_KEY: " secret ",
    XAI_MODEL: "grok-4.6",
    XAI_BASE_URL: "https://us.api.x.ai/v1",
    AGENT_MAX_STEPS: "3",
  });
  assert.equal(config.apiKey, "secret");
  assert.equal(config.model, "grok-4.6");
  assert.equal(config.baseURL, "https://us.api.x.ai/v1");
  assert.equal(config.maxSteps, 3);
});

test("a blank model name falls back to the default", () => {
  assert.equal(loadConfig({ XAI_MODEL: "   " }).model, DEFAULT_MODEL);
});

test("a bad step budget is rejected", () => {
  assert.throws(() => loadConfig({ AGENT_MAX_STEPS: "0" }), /AGENT_MAX_STEPS/);
  assert.throws(() => parsePositiveInt("nope", 8, "AGENT_MAX_STEPS"), /positive integer/);
});

test("dotenv fills missing keys and does not override existing ones", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "env-"));
  const file = path.join(dir, ".env");
  writeFileSync(file, '# comment\nexport XAI_API_KEY="from-file"\nXAI_MODEL=grok-4.5\nIGNORED\n');

  const env: NodeJS.ProcessEnv = { XAI_MODEL: "from-env" };
  loadEnvFile(file, env);
  assert.equal(env.XAI_API_KEY, "from-file");
  assert.equal(env.XAI_MODEL, "from-env");

  loadEnvFile(path.join(dir, "missing.env"), env);
  assert.equal(env.XAI_API_KEY, "from-file");
});
