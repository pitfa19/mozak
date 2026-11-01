import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { executeOperation } from "../../core/src/api.ts";
import { setFocus } from "../../core/src/focus.ts";
import { handle, TOOLS } from "../src/server.ts";
import { cleanup, world } from "../../core/test/annotations-fixture.ts";

after(cleanup);

function call(rt: Parameters<typeof handle>[1], name: string, args: Record<string, unknown>) {
  const reply = handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, rt) as { result: { content: { text: string }[]; isError?: boolean } };
  const text = reply.result.content[0]!.text;
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* argument errors are plain text */ }
  return { isError: reply.result.isError === true, data };
}

test("MCP: mozak_focus reads the focus lists, read-only; no tool writes focus", () => {
  const w = world(["alpha", "beta"]);
  w.propose("alpha", "a1");
  setFocus(w.config, { scope: "alpha", plan: "a1", action: "add" });
  const before = readFileSync(w.config, "utf8");
  const rt = { inventory: w.inv(), execute: executeOperation };
  assert.deepEqual(call(rt, "mozak_focus", {}).data.focus, { alpha: ["a1"], beta: [] });
  assert.deepEqual(call(rt, "mozak_focus", { scope: "alpha" }).data.focus, { alpha: ["a1"] });
  const missing = call(rt, "mozak_focus", { scope: "gamma" });
  assert.equal(missing.isError, true);
  assert.match(JSON.stringify(missing.data), /scope-not-found/);
  assert.equal(call(rt, "mozak_focus", { scope: "alpha", plan: "a1" }).isError, true, "no extra arguments");
  assert.equal(readFileSync(w.config, "utf8"), before);
  assert.deepEqual(TOOLS.filter((t) => /focus/.test(t.name)).map((t) => t.name), ["mozak_focus"]);
});
