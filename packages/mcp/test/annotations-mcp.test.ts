import { after, test } from "node:test";
import assert from "node:assert/strict";
import { executeOperation } from "../../core/src/api.ts";
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

test("MCP: mozak_plan_graph, mozak_ready and plans sort read annotations; annotate is not reachable", () => {
  const w = world();
  w.propose("alpha", "a"); w.propose("alpha", "b");
  assert.equal(w.annotate("alpha", [{ kind: "ref", planId: "b", target: "alpha/a", relation: "needs", evidence: "Synthetic: b needs a." }]).exitCode, 0);
  const rt = { inventory: w.inv(), execute: executeOperation };
  const graph = call(rt, "mozak_plan_graph", { scope: "alpha" });
  assert.equal(graph.isError, false);
  assert.equal(graph.data.graph.counts.edges, 1);
  const ready = call(rt, "mozak_ready", { scope: "alpha" });
  assert.deepEqual(ready.data.ready.ready.map((r: { planId: string }) => r.planId), ["a"]);
  assert.deepEqual(ready.data.ready.blocked.map((r: { planId: string }) => r.planId), ["b"]);
  const plans = call(rt, "mozak_plans", { scope: "alpha", sort: "deadline" });
  assert.equal(plans.isError, false);
  assert.equal(call(rt, "mozak_plans", { scope: "alpha", sort: "title" }).isError, true);
  assert.equal(TOOLS.some((t) => t.op === "annotate"), false);
  // Even a direct agent call through the shared facade is refused before any file is touched.
  const before = w.token("alpha");
  const refused = executeOperation(w.inv(), "annotate", { scope: "alpha", request: {} }, "agent");
  assert.equal(refused.data.status, "not-permitted");
  assert.deepEqual(w.token("alpha"), before);
});
