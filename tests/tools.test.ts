import assert from "node:assert/strict";
import { test } from "node:test";
import { createDefaultTools } from "../src/tools/index.ts";

test("the built-in tool list", () => {
  // The exercise in the README adds a tool. Update this list when you do.
  const tools = createDefaultTools({ scratchDir: "/tmp/scratch-unused" });
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["calculator", "scratchpad", "fetch_url"],
  );
});
