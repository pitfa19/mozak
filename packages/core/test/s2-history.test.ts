// S2 `check --history N`: hand edits of mozak.json found in git history. Synthetic temp repos only, no network.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, world } from "./annotations-fixture.ts";
import { handEditHistory } from "../src/history.ts";

after(cleanup);

const g = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
const commitAll = (root: string, message: string) => { g(root, "add", "-A"); g(root, "commit", "-q", "-m", message); };

test("check --history finds a commit that removed plans while keeping storage.revision, and one with a foreign revision", () => {
  const w = world(["alpha"], { git: true });
  const root = w.entries.alpha.root;
  commitAll(root, "init");
  w.propose("alpha", "keep");
  w.propose("alpha", "dropped", {}, false);
  w.reject("alpha", "dropped");
  commitAll(root, "agent writes");
  // Hand edit like vault commit bada5de: remove a rejected plan, keep storage.revision.
  const path = join(root, "mozak.json");
  const state = JSON.parse(readFileSync(path, "utf8"));
  state.plans = state.plans.filter((p: { id: string }) => p.id !== "dropped");
  writeFileSync(path, JSON.stringify(state));
  commitAll(root, "hand prune");
  // Clean history so far apart from that one commit.
  let report = handEditHistory(root, 10);
  assert.equal(report.available, true);
  assert.equal(report.scanned, 3);
  assert.deepEqual(report.findings.map((f) => [f.code, f.removedPlans]), [["hand-edit", ["dropped"]]]);
  // A hand edit that also invents a revision.
  state.storage.revision = "hand-made-revision";
  writeFileSync(path, JSON.stringify(state));
  commitAll(root, "hand revision");
  report = handEditHistory(root, 10);
  assert.deepEqual(report.findings.map((f) => f.code), ["hand-edit-revision", "hand-edit"]);
  // N limits the walk to the newest commits.
  assert.deepEqual(handEditHistory(root, 1).findings.map((f) => f.code), ["hand-edit-revision"]);
  assert.equal(handEditHistory(root, 1).scanned, 1);

  const out = w.op("check", { scope: "alpha", history: 10 });
  const codes = (out.data.issues as { code: string }[]).map((i) => i.code);
  assert.ok(codes.includes("hand-edit") && codes.includes("hand-edit-revision"), codes.join(","));
  assert.deepEqual(out.data.history, { scanned: 4, available: true, handEdits: 2 });
  assert.equal(out.exitCode, 3);
  assert.equal(w.op("check", { scope: "alpha", history: 0 }).data.status, "invalid-input");
  assert.equal(w.op("check", { scope: "alpha", history: "5" }).data.status, "invalid-input");
});

test("check --history on clean mozak history and outside git", () => {
  const w = world(["alpha"], { git: true });
  const root = w.entries.alpha.root;
  commitAll(root, "init");
  w.propose("alpha", "a");
  commitAll(root, "write");
  w.propose("alpha", "b");
  commitAll(root, "write");
  const report = handEditHistory(root, 50);
  assert.equal(report.scanned, 3);
  assert.deepEqual(report.findings, []);
  assert.equal(w.op("check", { scope: "alpha", history: 50 }).exitCode, 0);

  const plain = world(["beta"]);
  const none = plain.op("check", { scope: "beta", history: 5 });
  assert.equal(none.exitCode, 0);
  assert.equal((none.data.issues as { code: string }[]).some((i) => i.code === "history-unavailable"), true);
});
