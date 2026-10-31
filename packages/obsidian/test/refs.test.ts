import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadScopesModel } from "../src/load.ts";
import { cleanup, world } from "../../core/test/annotations-fixture.ts";

after(cleanup);

test("plugin model shows outgoing and incoming owner refs, including across scopes and dangling targets", () => {
  const w = world(["alpha", "beta"]);
  w.propose("alpha", "a", { title: "Synthetic alpha A" });
  w.propose("alpha", "b", { title: "Synthetic alpha B" });
  w.propose("beta", "c", { title: "Synthetic beta C" });
  w.propose("alpha", "gone");
  assert.equal(w.annotate("alpha", [
    { kind: "ref", planId: "a", target: "alpha/b", relation: "needs", evidence: "A needs B." },
    { kind: "ref", planId: "a", target: "beta/c", relation: "informs", evidence: "A informs C." },
    { kind: "ref", planId: "b", target: "alpha/gone", relation: "supersedes", evidence: "B replaces gone." },
  ]).exitCode, 0);
  const path = join(w.entries.alpha.root, "mozak.json");
  const state = JSON.parse(readFileSync(path, "utf8"));
  state.plans = state.plans.filter((p: { id: string }) => p.id !== "gone");
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
  const model = loadScopesModel(w.config);
  const plan = (scope: string, id: string) => model.scopes.find((s) => s.id === scope)!.plans.find((p) => p.id === id)!;
  const show = (scope: string, id: string) => (plan(scope, id).refs ?? []).map((r) => `${r.direction} ${r.verb} ${r.label} ${r.status}`);
  assert.deepEqual(show("alpha", "a"), ["out needs Synthetic alpha B resolved", "out informs Synthetic beta C resolved"]);
  assert.deepEqual(show("alpha", "b"), ["out supersedes alpha/gone dangling", "in needed by Synthetic alpha A resolved"]);
  assert.deepEqual(show("beta", "c"), ["in informed by Synthetic alpha A resolved"]);
});

