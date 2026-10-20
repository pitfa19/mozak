import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, NOW, world } from "../../core/test/annotations-fixture.ts";

// Real CLI subprocess runs against synthetic temp scopes only.
const cliPath = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "dist", "index.js");
after(cleanup);

function cli(args: string[]) {
  if (!existsSync(cliPath)) throw new Error(`built CLI missing at ${cliPath}; run "npm run build" first`);
  const r = spawnSync(process.execPath, ["--no-warnings", cliPath, ...args], { encoding: "utf8", timeout: 30000 });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

test("CLI: annotate (owner route), graph, ready and plans --sort deadline on a synthetic scope", () => {
  const w = world();
  w.propose("alpha", "a", { purpose: "Synthetic plan a, due 2099-05-01." });
  w.propose("alpha", "b");
  const request = join(w.base, "annotate.json");
  writeFileSync(request, JSON.stringify({ operationId: "cli-annotate-1", scopeId: "alpha", expectedAnnotations: { exists: false, sha256: null }, ownerRef: "synthetic:cli-owner", ownerMessageAt: NOW, items: [{ kind: "ref", planId: "b", target: "alpha/a", relation: "needs", evidence: "Synthetic: b needs a." }] }));
  const annotate = cli(["annotate", "--config", w.config, "--scope", "alpha", "--request", request]);
  assert.equal(annotate.code, 0, annotate.out + annotate.err);
  assert.equal(JSON.parse(annotate.out).status, "ok");
  const replay = cli(["annotate", "--config", w.config, "--scope", "alpha", "--request", request]);
  assert.equal(JSON.parse(replay.out).status, "replayed");

  const graph = cli(["graph", "--config", w.config, "--scope", "alpha"]);
  assert.equal(graph.code, 0);
  assert.deepEqual(JSON.parse(graph.out).graph.edges.map((e: { from: string; to: string; relation: string }) => [e.from, e.relation, e.to]), [["alpha/b", "needs", "alpha/a"]]);

  const ready = cli(["ready", "--config", w.config, "--scope", "alpha", "--json"]);
  assert.equal(ready.code, 0);
  const r = JSON.parse(ready.out).ready;
  assert.deepEqual(r.ready.map((x: { planId: string; deadline: string }) => [x.planId, x.deadline]), [["a", "2099-05-01"]]);
  assert.deepEqual(r.blocked.map((x: { planId: string }) => x.planId), ["b"]);

  const plans = cli(["plans", "--config", w.config, "--scope", "alpha", "--sort", "deadline"]);
  assert.equal(plans.code, 0);
  assert.match(plans.out, /deadline: 2099-05-01 \(inferred\)/);

  assert.equal(cli(["graph", "--config", w.config]).code, 2);
  assert.equal(cli(["ready", "--config", w.config, "--scope", "alpha", "--all"]).code, 2);
});
