// Focus list: plan ids the owner starred, stored per scope entry in mozak-inventory.json. Synthetic temp folders only.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, world } from "./annotations-fixture.ts";
import { executeOperation } from "../src/api.ts";
import { loadInventory } from "../src/scope-index.ts";
import { focusChange, focusList, jsonStyle, readFocus, renderFocus, setFocus } from "../src/focus.ts";

after(cleanup);
type Issue = { code: string; message: string };

/** A two-scope world whose inventory file has a style of its own: one-space indent, x keys, a remote entry, no final newline. */
function styled() {
  const w = world(["alpha", "beta"]);
  w.propose("alpha", "a1"); w.propose("alpha", "a2"); w.propose("beta", "b1");
  const text = '{\n "format": "mozak.local/v3",\n "x": { "note": "kept" },\n "scopes": [\n  {\n   "id": "beta",\n   "root": "beta",\n   "x": { "colour": "blue" }\n  },\n  {\n   "id": "alpha",\n   "root": "alpha"\n  },\n  {\n   "id": "web",\n   "remote": "github:owner/web",\n   "ref": "main"\n  }\n ]\n}';
  writeFileSync(w.config, text);
  return { w, text };
}
const raw = (path: string) => JSON.parse(readFileSync(path, "utf8"));

test("readFocus: no focus key is an empty list for every scope, including remote entries", () => {
  const { w } = styled();
  assert.deepEqual(readFocus(w.config), { alpha: [], beta: [], web: [] });
});

test("setFocus add keeps entry order, indent, final newline style and every other key, and the digest", () => {
  const { w, text } = styled();
  const digest = loadInventory(w.config).digest;
  const out = setFocus(w.config, { scope: "alpha", plan: "a2", action: "add" });
  assert.deepEqual(out, { scope: "alpha", focus: ["a2"], changed: true });
  const after1 = readFileSync(w.config, "utf8");
  assert.equal(after1.endsWith("}"), true, "no final newline added");
  assert.match(after1, /^\{\n "format"/, "one-space indent kept");
  const obj = raw(w.config);
  assert.deepEqual(obj.x, { note: "kept" });
  assert.deepEqual(obj.scopes.map((s: { id: string }) => s.id), ["beta", "alpha", "web"]);
  assert.deepEqual(obj.scopes[0].x, { colour: "blue" });
  assert.deepEqual(obj.scopes[1].focus, ["a2"]);
  assert.equal(loadInventory(w.config).digest, digest, "focus never changes the inventory digest");
  setFocus(w.config, { scope: "alpha", plan: "a1", action: "add" });
  assert.deepEqual(readFocus(w.config).alpha, ["a2", "a1"]);
  setFocus(w.config, { scope: "alpha", plan: "a2", action: "remove" });
  setFocus(w.config, { scope: "alpha", plan: "a1", action: "remove" });
  assert.deepEqual(raw(w.config).scopes[1].focus, [], "an emptied list stays as []");
  assert.notEqual(readFileSync(w.config, "utf8"), text);
});

test("setFocus is idempotent: adding twice or removing an absent id changes nothing on disk", () => {
  const { w } = styled();
  setFocus(w.config, { scope: "beta", plan: "b1", action: "add" });
  const once = readFileSync(w.config, "utf8");
  assert.deepEqual(setFocus(w.config, { scope: "beta", plan: "b1", action: "add" }), { scope: "beta", focus: ["b1"], changed: false });
  assert.equal(readFileSync(w.config, "utf8"), once);
  assert.deepEqual(setFocus(w.config, { scope: "alpha", plan: "a1", action: "remove" }), { scope: "alpha", focus: [], changed: false });
  assert.equal(readFileSync(w.config, "utf8"), once);
});

test("setFocus add refuses an unknown scope or plan and leaves the file byte-identical", () => {
  const { w, text } = styled();
  assert.throws(() => setFocus(w.config, { scope: "gamma", plan: "a1", action: "add" }), { code: "scope-not-found" });
  assert.throws(() => setFocus(w.config, { scope: "alpha", plan: "b1", action: "add" }), { code: "plan-not-found" });
  assert.throws(() => setFocus(w.config, { scope: "alpha", plan: "a1", action: "toggle" as "add" }), { code: "invalid-input" });
  assert.equal(readFileSync(w.config, "utf8"), text);
});

test("setFocus remove works for a plan that no longer exists, so a stale star can be cleared", () => {
  const { w } = styled();
  setFocus(w.config, { scope: "alpha", plan: "a1", action: "add" });
  const obj = raw(w.config);
  obj.scopes[1].focus.push("gone");
  writeFileSync(w.config, JSON.stringify(obj, null, 1));
  assert.deepEqual(setFocus(w.config, { scope: "alpha", plan: "gone", action: "remove" }).focus, ["a1"]);
});

test("the inventory loader accepts focus on local and remote entries and refuses a bad one", () => {
  const { w } = styled();
  const put = (focus: unknown, index = 1) => { const o = raw(w.config); o.scopes[index].focus = focus; writeFileSync(w.config, JSON.stringify(o, null, 1)); };
  put(["a1"]); assert.doesNotThrow(() => loadInventory(w.config));
  put(["x"], 2); assert.doesNotThrow(() => loadInventory(w.config));
  for (const bad of ["a1", [1], ["a1", "a1"], [""], {}]) {
    put(bad);
    assert.throws(() => loadInventory(w.config), { code: "inventory-invalid" }, JSON.stringify(bad));
  }
});

test("a failed write leaves the old file valid and no temp file behind", () => {
  const { w, text } = styled();
  // A busy inventory lock: the write waits briefly, then refuses with busy and writes nothing.
  mkdirSync(join(w.base, ".mozak-inventory-lock"));
  writeFileSync(join(w.base, ".mozak-inventory-lock", "owner.json"), JSON.stringify({ token: "t", pid: 1 }));
  assert.throws(() => setFocus(w.config, { scope: "alpha", plan: "a1", action: "add" }, { lockTimeoutMs: 20 }), { code: "busy" });
  assert.equal(readFileSync(w.config, "utf8"), text);
  assert.deepEqual(readdirSync(w.base).filter((n) => n.endsWith(".tmp")), []);
});

test("check warns focus-unknown-plan for a starred id that no longer exists, never an error", () => {
  const w = world(["alpha"]);
  w.propose("alpha", "a1");
  setFocus(w.config, { scope: "alpha", plan: "a1", action: "add" });
  const obj = raw(w.config); obj.scopes[0].focus.push("gone"); writeFileSync(w.config, JSON.stringify(obj, null, 1));
  const check = executeOperation(loadInventory(w.config), "check", { scope: "alpha" });
  assert.equal(check.exitCode, 0, JSON.stringify(check.data));
  assert.equal(check.data.status, "ok");
  const issues = check.data.issues as Issue[];
  assert.deepEqual(issues.filter((i) => i.code === "focus-unknown-plan").map((i) => i.message.includes("gone")), [true]);
});

test("focus is never written to mozak.json or mozak.md", () => {
  const { w } = styled();
  const before = w.bytes("alpha");
  setFocus(w.config, { scope: "alpha", plan: "a1", action: "add" });
  assert.deepEqual(w.bytes("alpha"), before);
});

test("focusList and focusChange return envelopes; renderFocus prints one line per scope", () => {
  const { w } = styled();
  assert.deepEqual(focusChange(w.config, { scope: "alpha", plan: "a1", action: "add" }), { exitCode: 0, data: { status: "ok", scope: "alpha", focus: ["a1"], changed: true } });
  const bad = focusChange(w.config, { scope: "alpha", plan: "nope", action: "add" });
  assert.equal(bad.exitCode, 2);
  assert.equal(bad.data.status, "plan-not-found");
  assert.deepEqual(focusList(loadInventory(w.config), {}).data.focus, { alpha: ["a1"], beta: [], web: [] });
  assert.deepEqual(focusList(loadInventory(w.config), { scope: "alpha" }), { exitCode: 0, data: { status: "ok", focus: { alpha: ["a1"] } } });
  const missing = focusList(loadInventory(w.config), { scope: "gamma" });
  assert.equal(missing.exitCode, 2);
  assert.equal(missing.data.status, "scope-not-found");
  const inv = loadInventory(w.config);
  assert.deepEqual(focusList({ format: inv.format, scopes: inv.scopes, digest: inv.digest }, {}).data.focus, { alpha: [], beta: [], web: [] }, "an inventory without a file has empty lists");
  assert.equal(renderFocus({ alpha: ["a1", "a2"], beta: [] }), "alpha: a1, a2\nbeta: (none)\n");
});

test("jsonStyle keeps tab indents and the default when the file has none", () => {
  assert.deepEqual(jsonStyle('{\n\t"a": 1\n}\n'), { indent: "\t", newline: true });
  assert.deepEqual(jsonStyle('{"a":1}'), { indent: "  ", newline: false });
});
