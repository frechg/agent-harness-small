import type { ToolParameters } from "../types.js";

/**
 * One tool, one file. Copy `calculator.ts` when you add another.
 * `execute` returns the text the model will read, or throws. The loop turns
 * a throw into a tool message so the model can react. It does not crash the run.
 */
export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute(args: unknown): Promise<string> | string;
}
