import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createScratchpadTool } from "../src/tools/scratchpad.ts";

function pad() {
  const dir = mkdtempSync(path.join(tmpdir(), "scratch-"));
  return { dir, tool: createScratchpadTool(dir) };
}

test("write replaces a file and read returns it", async () => {
  const { tool } = pad();
  assert.match(String(await tool.execute({ action: "write", content: "one" })), /wrote notes.txt/);
  assert.equal(await tool.execute({ action: "write", name: "notes.txt", content: "two" }), "wrote notes.txt (3 characters)");
  assert.equal(await tool.execute({ action: "read" }), "two");
});

test("two file names do not collide", async () => {
  const { tool } = pad();
  await tool.execute({ action: "write", name: "a.txt", content: "aaa" });
  await tool.execute({ action: "write", name: "b.txt", content: "bbb" });
  assert.equal(await tool.execute({ action: "read", name: "a.txt" }), "aaa");
  assert.equal(await tool.execute({ action: "read", name: "b.txt" }), "bbb");
});

test("a missing file and a path escape are errors", async () => {
  const { tool } = pad();
  await assert.rejects(() => tool.execute({ action: "read" }), /does not exist/);
  await assert.rejects(() => tool.execute({ action: "read", name: "../secret" }), /single file name/);
  await assert.rejects(() => tool.execute({ action: "write", name: "nested/file.txt", content: "x" }), /single file name/);
  await assert.rejects(() => tool.execute({ action: "write", content: 1 }), /content/);
});
