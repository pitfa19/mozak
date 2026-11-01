// The sidebar Focus tab and star toggle, through the real loader and core. Synthetic temp folders only.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadScopesModel, toggleFocus } from "../src/load.ts";
import { planMatches } from "../src/model.ts";
import { cleanup, world } from "../../core/test/annotations-fixture.ts";

after(cleanup);

test("the star adds and removes a plan in Focus through the inventory only; plan files never change", () => {
  const w = world(["alpha"]);
  w.propose("alpha", "a1"); w.propose("alpha", "a2");
  const before = w.bytes("alpha");
  const focused = () => loadScopesModel(w.config).scopes[0]!.plans.filter((p) => planMatches(p, "focus")).map((p) => p.id);
  assert.deepEqual(focused(), []);
  assert.deepEqual(toggleFocus(w.config, "alpha", "a2", false), { ok: true, focus: ["a2"] });
  assert.deepEqual(focused(), ["a2"]);
  assert.deepEqual(JSON.parse(readFileSync(w.config, "utf8")).scopes[0].focus, ["a2"]);
  assert.deepEqual(toggleFocus(w.config, "alpha", "a2", true), { ok: true, focus: [] });
  assert.deepEqual(focused(), []);
  assert.deepEqual(w.bytes("alpha"), before);
});

test("a failed star reports the reason and leaves the inventory unchanged", () => {
  const w = world(["alpha"]);
  const text = readFileSync(w.config, "utf8");
  const out = toggleFocus(w.config, "alpha", "missing", false);
  assert.equal(out.ok, false);
  assert.equal(out.ok === false && out.code, "plan-not-found");
  assert.equal(readFileSync(w.config, "utf8"), text);
});

test("the view has no All tab, a star on every plan row, and the Focus empty message", () => {
  const src = readFileSync(new URL("../src/views.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /"all"/);
  assert.match(src, /mozak-star/);
  assert.match(src, /ev\.stopPropagation\(\); this\.toggleStar\(scope, plan\)/, "the star stops the row click that opens the plan");
  assert.match(src, /Star a plan to focus on it/);
  assert.match(src, /lastFilter = filter/, "the last tab is remembered in plugin settings");
});
