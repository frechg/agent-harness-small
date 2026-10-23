import { createCalculatorTool } from "./calculator.js";
import { createFetchUrlTool } from "./fetch-url.js";
import { createScratchpadTool } from "./scratchpad.js";
import type { Tool } from "./types.js";

export interface DefaultToolOptions {
  scratchDir: string;
  /** Tests inject a fake fetch. The CLI leaves this unset and uses global fetch. */
  fetchImpl?: typeof fetch;
}

/** The tool list the CLI gives the model. Add a new tool here. */
export function createDefaultTools(options: DefaultToolOptions): Tool[] {
  return [
    createCalculatorTool(),
    createScratchpadTool(options.scratchDir),
    createFetchUrlTool(options.fetchImpl),
  ];
}
