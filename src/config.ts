/**
 * Environment variables. The CLI loads `.env` first; tests pass a plain object
 * so a developer's real key never leaks into a unit test.
 */

import { existsSync, readFileSync } from "node:fs";

export const DEFAULT_MODEL = "grok-4.7";
export const DEFAULT_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_MAX_STEPS = 8;
/** Reasoning models can think for a long time before the tool call comes back. */
export const DEFAULT_TIMEOUT_MS = 120_000;

export interface AppConfig {
  apiKey: string | undefined;
  model: string;
  baseURL: string;
  maxSteps: number;
  timeoutMs: number;
  traceDir: string;
  scratchDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  return {
    apiKey: blankToUndefined(env.XAI_API_KEY),
    model: blankToUndefined(env.XAI_MODEL) ?? DEFAULT_MODEL,
    baseURL: blankToUndefined(env.XAI_BASE_URL) ?? DEFAULT_BASE_URL,
    maxSteps: parsePositiveInt(env.AGENT_MAX_STEPS, DEFAULT_MAX_STEPS, "AGENT_MAX_STEPS"),
    timeoutMs: parsePositiveInt(env.XAI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, "XAI_TIMEOUT_MS"),
    traceDir: blankToUndefined(env.AGENT_TRACE_DIR) ?? "traces",
    scratchDir: blankToUndefined(env.AGENT_SCRATCH_DIR) ?? "scratch",
  };
}

export function requireApiKey(config: AppConfig): string {
  if (!config.apiKey) {
    throw new Error(
      "XAI_API_KEY is not set. Copy .env.example to .env and add a key from https://console.x.ai/.",
    );
  }
  return config.apiKey;
}

/**
 * A tiny `.env` reader. Existing variables win, so a hosted machine can inject
 * the key without fighting a file baked into an image.
 */
export function loadEnvFile(filePath: string, env: NodeJS.ProcessEnv): void {
  if (!existsSync(filePath)) return;

  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key !== "" && env[key] === undefined) {
      env[key] = value;
    }
  }
}

export function parsePositiveInt(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
