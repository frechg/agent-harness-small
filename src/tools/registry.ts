import type { ToolDefinition } from "../types.js";
import type { Tool } from "./types.js";

/**
 * Looks up a tool by the name the model sent and parses its argument string.
 * Parsing lives here so every tool can assume it received a value, and so a
 * bad JSON payload becomes an error the model can read.
 */
export class ToolRegistry {
  private readonly tools: readonly Tool[];

  constructor(tools: readonly Tool[]) {
    const names = new Set<string>();
    for (const tool of tools) {
      if (names.has(tool.name)) {
        throw new Error(`duplicate tool name "${tool.name}"`);
      }
      names.add(tool.name);
    }
    this.tools = tools;
  }

  definitions(): ToolDefinition[] {
    return this.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  async call(name: string, rawArguments: string): Promise<string> {
    const tool = this.tools.find((candidate) => candidate.name === name);
    if (!tool) {
      const known = this.tools.map((candidate) => candidate.name).join(", ");
      throw new Error(`unknown tool "${name}". Known tools: ${known}`);
    }
    const args = parseArguments(rawArguments);
    return tool.execute(args);
  }
}

function parseArguments(raw: string): unknown {
  const trimmed = raw.trim();
  // Some models send an empty string when a tool takes no arguments.
  if (trimmed === "") return {};
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(`tool arguments were not valid JSON: ${raw}`);
  }
}
