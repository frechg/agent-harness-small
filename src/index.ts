/**
 * Public surface for tests and for later stages.
 * The CLI is `src/cli.ts`. Import from here when you want the loop without the argv parser.
 */

export { runAgent, createRunId, DEFAULT_SYSTEM_PROMPT } from "./agent/loop.js";
export { createXaiModel, toApiMessages, toApiTools, toModelResponse } from "./agent/model.js";
export type { XaiModelOptions, ChatCompletionLike } from "./agent/model.js";
export { loadConfig, loadEnvFile, requireApiKey, DEFAULT_MODEL, DEFAULT_BASE_URL } from "./config.js";
export { createDefaultTools } from "./tools/index.js";
export { ToolRegistry } from "./tools/registry.js";
export { createCalculatorTool, evaluateArithmetic } from "./tools/calculator.js";
export { createScratchpadTool } from "./tools/scratchpad.js";
export { createFetchUrlTool } from "./tools/fetch-url.js";
export type { Tool } from "./tools/types.js";
export { combineTraces, createConsoleTrace, createJsonlTrace, MemoryTrace } from "./trace/logger.js";
export type {
  AgentResult,
  ChatMessage,
  ModelClient,
  ModelRequest,
  ModelResponse,
  ToolCall,
  ToolDefinition,
  TraceEvent,
  TraceSink,
} from "./types.js";
