import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expectRecord, expectString } from "./args.js";
import type { Tool } from "./types.js";

/**
 * One scratch directory, file names only (no slashes, no `..`).
 * `write` replaces the whole file. There is no append yet; that is a small
 * exercise if you want one.
 */
export function createScratchpadTool(scratchDir: string): Tool {
  const root = path.resolve(scratchDir);

  return {
    name: "scratchpad",
    description:
      "Read or replace a text file in the scratch directory. Use it to keep notes between steps. The name is a single file name such as notes.txt, not a path.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["read", "write"],
          description: "read returns the file. write replaces the whole file.",
        },
        content: {
          type: "string",
          description: "Required when action is write. The full new text.",
        },
        name: {
          type: "string",
          description: "File name inside the scratch directory. Defaults to notes.txt.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(args) {
      const obj = expectRecord(args);
      const action = expectString(obj, "action");
      const name = fileName(typeof obj.name === "string" && obj.name.length > 0 ? obj.name : "notes.txt");
      const file = path.join(root, name);

      if (action === "read") {
        try {
          return await readFile(file, "utf8");
        } catch (error) {
          if (isNotFound(error)) {
            throw new Error(`scratchpad "${name}" does not exist yet. Write it first.`);
          }
          throw error;
        }
      }

      if (action === "write") {
        if (typeof obj.content !== "string") {
          throw new Error('write requires a string "content" field');
        }
        await mkdir(root, { recursive: true });
        await writeFile(file, obj.content, "utf8");
        return `wrote ${name} (${obj.content.length} characters)`;
      }

      throw new Error(`unknown scratchpad action "${action}". Use read or write.`);
    },
  };
}

function fileName(name: string): string {
  // A single path segment. Rejecting slashes means path.join cannot escape root.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new Error(
      `scratchpad name "${name}" is not a single file name. Use letters, numbers, dots, "_" or "-".`,
    );
  }
  return name;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
