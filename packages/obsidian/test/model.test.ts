import { test } from "node:test";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMutation, executeOperation, initScopeState, loadInventory, mutateScope, readScope, renderBridge, renderBridgeLegacy, reviewShow } from "@mozak/core";
import { chooseInventory, discoverInventory } from "../src/discover.ts";
import { countRemote, countsSummary, headingLine, planMatches, remoteVM, resolveOpenTarget, scopesModel, scopeViewModel, stripVM } from "../src/model.ts";
import { loadScopesModel, renderStaleProjections } from "../src/load.ts";

test("planMatches: all shows every state, open groups in-play states, completed is exact", () => {
  const states = ["open", "awaiting", "paused", "completed", "rejected"] as const;
  const pick = (f: "all" | "open" | "completed") => states.filter((s) => planMatches({ state: s }, f));
  assert.deepEqual(pick("all"), [...states]);
  assert.deepEqual(pick("open"), ["open", "awaiting", "paused"]);
  assert.deepEqual(pick("completed"), ["completed"]);
});

test("countsSummary omits zero parts", () => {
  assert.equal(countsSummary({ completed: 0, open: 0, awaiting: 0 }), "no plans");
  assert.equal(countsSummary({ completed: 2, open: 1, awaiting: 3 }), "1 open, 3 awaiting, 2 completed");
});

test("resolveOpenTarget separates vault files from outside files", () => {
  assert.deepEqual(resolveOpenTarget("/v/rector_award", "/v/rector_award/a/mozak.md"), { kind: "vault", path: "a/mozak.md" });
  assert.deepEqual(resolveOpenTarget("/v/rector_award", "/v/anpit/mozak.md"), { kind: "external", path: "/v/anpit/mozak.md" });
  assert.deepEqual(resolveOpenTarget("/v/a", "/v/ab/mozak.md"), { kind: "external", path: "/v/ab/mozak.md" });
});

test("failed scope becomes an error row and counts as failed", () => {
  const vm = scopeViewModel({ id: "x", root: "/nope", entryFiles: [], error: { code: "scope-root-missing", message: "gone" } });
  assert.equal(vm.status, "failed");
  assert.equal(vm.errorCode, "scope-root-missing");
  assert.equal(vm.hasMozakMd, false);
  const m = scopesModel("/inv.json", [{ id: "x", root: "/nope", entryFiles: [], error: { code: "c", message: "m" } }]);
  assert.equal(m.totals.failed, 1);
  assert.equal(m.totals.scopes, 1);
});

test("discoverInventory walks up from the vault and chooseInventory prefers the setting", () => {
  const top = mkdtempSync(join(tmpdir(), "mozak-obs-"));
  const vault = join(top, "repo", "vault");
  mkdirSync(vault, { recursive: true });
  assert.equal(discoverInventory(vault), null);
  writeFileSync(join(top, "repo", "mozak-inventory.json"), "{}");
  assert.equal(discoverInventory(vault), join(top, "repo", "mozak-inventory.json"));
  assert.deepEqual(chooseInventory("", vault), { path: join(top, "repo", "mozak-inventory.json"), source: "auto" });
  assert.deepEqual(chooseInventory("/x/inv.json", vault), { path: "/x/inv.json", source: "setting" });
  assert.deepEqual(chooseInventory("", null), { path: null, source: "none" });
});

test("loadScopesModel reads a real core inventory, one scope failing without hiding the rest", () => {
  const top = mkdtempSync(join(tmpdir(), "mozak-obs-"));
  mkdirSync(join(top, "empty"));
  writeFileSync(
    join(top, "mozak-inventory.json"),
    JSON.stringify({ format: "mozak.local/v2", scopes: [{ id: "empty", root: "empty" }, { id: "gone", root: "gone" }] }),
  );
  const m = loadScopesModel(join(top, "mozak-inventory.json"));
  assert.equal(m.scopes.length, 2);
  assert.equal(m.totals.failed, 2);
  assert.equal(m.scopes.find((s) => s.id === "gone")?.errorCode, "scope-root-missing");
  assert.equal(m.scopes.find((s) => s.id === "empty")?.errorCode, "scope-uninitialized");
});

test("remoteVM marks a copy stale when never fetched, failed, or older than ten minutes", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  const iso = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString();
  assert.equal(remoteVM("github:o/r", "main", { lastFetchAt: iso(2), lastError: null }, now).stale, false);
  assert.equal(remoteVM("github:o/r", "main", { lastFetchAt: iso(11), lastError: null }, now).stale, true);
  assert.equal(remoteVM("github:o/r", "main", { lastFetchAt: null, lastError: null }, now).staleReason, "never fetched");
  assert.equal(remoteVM("github:o/r", "main", { lastFetchAt: iso(1), lastError: "offline" }, now).staleReason, "offline");
});

test("remote scopes carry their badge data through the view model and are counted", () => {
  const remote = remoteVM("github:o/r", "main", { lastFetchAt: null, lastError: null });
  const a = scopeViewModel({ id: "r", root: "/c", entryFiles: [], error: { code: "scope-root-missing", message: "x" }, remote });
  const b = scopeViewModel({ id: "l", root: "/l", entryFiles: [], error: { code: "x", message: "y" } });
  assert.equal(a.remote?.spec, "github:o/r");
  assert.equal(b.remote, null);
  assert.deepEqual(countRemote([a, b]), { remote: 1, stale: 1 });
});

test("vault-plans scopes keep the repo badge, are never stale, open plans inside the vault, and need no sync", () => {
  const base = mkdtempSync(join(process.env.JCODE_SCRATCH_DIR ?? tmpdir(), "mozak-obs-vault-"));
  const vault = join(base, "vault");
  const plans = join(vault, "creations", "tool");
  mkdirSync(plans, { recursive: true });
  writeFileSync(join(plans, "README.md"), "# r\n");
  writeFileSync(join(plans, "AGENTS.md"), "# a\n");
  const inv = join(vault, "mozak-inventory.json");
  writeFileSync(inv, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "tool", remote: "github:o/tool", plans: "creations/tool" }] }));
  initScopeState(loadInventory(inv).scopes[0]!, { operationId: "i", scopeId: "tool", kind: "project", title: "Tool", expectedAbsent: { graph: true, bridge: true }, ownerRef: "host:t", ownerMessageAt: "2026-10-18T08:50:00.000Z" });
  const model = loadScopesModel(inv);
  const scope = model.scopes[0]!;
  assert.equal(scope.status, "ok");
  assert.equal(scope.remote?.spec, "github:o/tool");
  assert.equal(scope.remote?.vault, true);
  assert.equal(scope.remote?.stale, false);
  assert.deepEqual(countRemote(model.scopes), { remote: 0, stale: 0 });
  assert.equal(resolveOpenTarget(vault, join(scope.root, "mozak.md")).kind, "vault");
  assert.equal(remoteVM("github:o/r", "main", { lastFetchAt: null, lastError: "offline" }, new Date(), undefined, true).stale, false);
  assert.equal(scope.remote?.visibility, null, "never checked shows no badge");
  assert.equal(remoteVM("github:o/r", "main", { lastFetchAt: null, lastError: null, visibility: "public" }, new Date(), undefined, true).visibility, "public");
  assert.equal(remoteVM("github:o/r", "main", { lastFetchAt: null, lastError: null, visibility: "private-or-missing" }).visibility, "private");
  assert.equal(remoteVM("github:o/r", "main", { lastFetchAt: null, lastError: null, visibility: "unknown" }).visibility, null);
});

// ---------- roadmap navigation (plan obsidian-roadmap) ----------

const scratchBase = process.env.JCODE_SCRATCH_DIR ?? tmpdir();
const OWNER_AT = "2026-10-12T08:00:00.000Z";
const roadContent = {
  title: "Road [one]", purpose: "Walk", constraints: [], nonGoals: [], rationale: "r", questions: [], sources: [],
  outcomes: [
    { id: "first-stop", statement: "First", acceptance: "objective", criterion: "c" },
    { id: "second-stop", statement: "Second", acceptance: "owner", criterion: "c" },
  ],
};
/** A synthetic inventory with one accepted plan whose first outcome has passing evidence. */
function roadWorld() {
  const top = mkdtempSync(join(scratchBase, "mozak-obs-road-"));
  mkdirSync(join(top, "road"));
  writeFileSync(join(top, "road", "README.md"), "# r\n");
  writeFileSync(join(top, "road", "AGENTS.md"), "# a\n");
  writeFileSync(join(top, "mozak-inventory.json"), JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "road", root: "road" }] }));
  const entry = { id: "road", root: join(top, "road") };
  initScopeState(entry, { operationId: "init", scopeId: "road", kind: "project", title: "Road scope", expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic-owner:init", ownerMessageAt: OWNER_AT });
  let n = 0;
  const change = (action: string, payload: unknown, actor: "agent" | "owner" = "agent") =>
    mutateScope(entry, { operationId: `op-${++n}`, scopeId: "road", expected: readScope(entry).snapshot, action, payload }, actor);
  change("propose", { planId: "road-plan", content: roadContent });
  const pending = readScope(entry).state.plans[0]!.pending!;
  const out = executeOperation(loadInventory(join(top, "mozak-inventory.json")), "review", { scope: "road", plan: "road-plan" }, "agent");
  const review = out.data.review as { reviewDigest: string };
  change("approve-direction", { planId: "road-plan", revisionId: pending.id, reviewDigest: review.reviewDigest, ownerRef: "synthetic-owner:approve", ownerMessageAt: OWNER_AT, reason: "fixture" }, "owner");
  const rev = readScope(entry).state.plans[0]!.accepted!.id;
  change("observe", {
    planId: "road-plan",
    observation: { id: "obs1", classification: "observed", summary: "first done", evidence: [{ id: "e1", locator: "test", anchor: null, version: null, inspectedAt: OWNER_AT, activity: { kind: "run", description: "ran" }, result: { verdict: "pass", summary: "ok" }, limitations: [] }] },
    reasoningLinks: [{ id: "l1", relation: "supports", from: { planId: "road-plan", revisionId: null, kind: "observation", id: "obs1" }, to: { planId: "road-plan", revisionId: rev, kind: "outcome", id: "first-stop" }, rationale: "fixture" }],
  });
  return { top, entry, inventory: join(top, "mozak-inventory.json") };
}

test("strip: one segment per outcome, done / current, from real core state", () => {
  const { entry } = roadWorld();
  const state = readScope(entry).state;
  const strip = stripVM(state, state.plans[0]!)!;
  assert.deepEqual(strip.stops.map((s) => s.key), ["done", "current"]);
  assert.equal(strip.done, 1);
  assert.equal(strip.total, 2);
});

test("plan row carries a strip and the exact mozak.md heading; the heading line is found in the rendered file", () => {
  const { inventory, entry } = roadWorld();
  const m = loadScopesModel(inventory);
  const plan = m.scopes[0]!.plans[0]!;
  assert.equal(plan.strip?.total, 2);
  assert.ok(plan.heading.startsWith("## Road \\[one\\] · `road-plan`"));
  const md = readFileSync(join(entry.root, "mozak.md"), "utf8");
  const line = headingLine(md, plan.heading);
  assert.notEqual(line, null);
  assert.equal(md.split("\n")[line!], plan.heading);
  assert.equal(headingLine("# nothing here\n", plan.heading), null);
});

test("awaiting plans have no strip", () => {
  const { entry } = roadWorld();
  const state = readScope(entry).state;
  const fake = { ...state.plans[0]!, accepted: null, lifecycle: { state: "unaccepted" as const } };
  assert.equal(stripVM(state, fake as typeof state.plans[0]), null);
});

test("completed sidebar rows resolve to their collapsed line in the real renderer", () => {
  const { entry } = roadWorld();
  let state = readScope(entry).state;
  const planId = "road-plan";
  const revisionId = state.plans[0]!.accepted!.id;
  const apply = (action: string, payload: unknown, actor = "agent") => {
    state = applyMutation(state, action, payload, actor, OWNER_AT).state;
  };
  apply("observe", {
    planId,
    observation: { id: "obs2", classification: "observed", summary: "second done", evidence: [{ id: "e2", locator: "test", anchor: null, version: null, inspectedAt: OWNER_AT, activity: { kind: "run", description: "ran" }, result: { verdict: "pass", summary: "ok" }, limitations: [] }] },
    reasoningLinks: [{ id: "l2", relation: "supports", from: { planId, revisionId: null, kind: "observation", id: "obs2" }, to: { planId, revisionId, kind: "outcome", id: "second-stop" }, rationale: "fixture" }],
  });
  const review = reviewShow(state, planId, "accept-outcome", "second-stop");
  apply("accept-outcome", { planId, revisionId, outcomeId: "second-stop", reviewDigest: review.reviewDigest, ownerRef: "synthetic-owner:accept", ownerMessageAt: OWNER_AT, reason: "fixture" }, "owner");
  apply("complete", { planId, revisionId });
  const model = scopeViewModel({ id: entry.id, root: entry.root, entryFiles: ["mozak.md"], state });
  const target = model.plans[0]!.heading;
  assert.match(target, /^- ✅ /);
  const md = renderBridge(state, "a".repeat(64));
  assert.notEqual(headingLine(md, target), null);
  assert.ok(headingLine(md, target)! > headingLine(md, "## Completed")!);
});

test("renderStaleProjections rewrites only mozak.md, leaves mozak.json byte-identical and spares hand edits", () => {
  const { inventory, entry } = roadWorld();
  const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
  const read = readScope(entry);
  writeFileSync(join(entry.root, "mozak.md"), renderBridgeLegacy(read.state, read.snapshot.graphHash));
  const json = sha(join(entry.root, "mozak.json"));
  const files = readdirSync(entry.root).sort();
  const r = renderStaleProjections(inventory);
  assert.equal(r.ok, true);
  assert.equal(r.rendered, 1);
  assert.equal(sha(join(entry.root, "mozak.json")), json);
  assert.deepEqual(readdirSync(entry.root).sort(), files);
  assert.ok(readFileSync(join(entry.root, "mozak.md"), "utf8").includes("```mermaid"));
  writeFileSync(join(entry.root, "mozak.md"), "my edits\n");
  const again = renderStaleProjections(inventory);
  assert.equal(again.ok, false);
  assert.equal(readFileSync(join(entry.root, "mozak.md"), "utf8"), "my edits\n");
});

test("the plan detail tab is gone: no PlanView class or registration remains", () => {
  const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  for (const f of ["views.ts", "main.ts", "model.ts"]) {
    assert.ok(!/class PlanView|new PlanView|registerView\(\s*LEGACY_PLAN_VIEW_TYPE/.test(src(f)), f);
  }
  assert.ok(src("main.ts").includes("getLeavesOfType(LEGACY_PLAN_VIEW_TYPE).forEach((l) => l.detach())"));
});

test("Obsidian community plugin submission checklist: root manifest, source hygiene, disclosures, and release workflow", () => {
  const repoRoot = new URL("../../../", import.meta.url);
  const readRepo = (rel: string) => readFileSync(new URL(rel, repoRoot), "utf8");
  const rootManifest = JSON.parse(readRepo("manifest.json"));
  const pkgManifest = JSON.parse(readRepo("packages/obsidian/manifest.json"));
  const rootPkg = JSON.parse(readRepo("package.json"));

  // 1. Root manifest.json and packages/obsidian/manifest.json are identical and valid.
  assert.deepEqual(rootManifest, pkgManifest, "root manifest.json matches packages/obsidian/manifest.json");
  const versions = JSON.parse(readRepo("versions.json"));
  assert.equal(versions[rootManifest.version], rootManifest.minAppVersion, "versions.json maps this release to its minimum app version");
  assert.equal(rootManifest.id, "mozak");
  assert.equal(rootManifest.name, "mozak");
  assert.equal(rootManifest.version, rootPkg.version);
  assert.match(rootManifest.minAppVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(rootManifest.isDesktopOnly, true, "uses Node APIs so isDesktopOnly must be true");
  assert.equal(typeof rootManifest.author, "string");
  assert.ok(rootManifest.author.length > 0);
  assert.equal(typeof rootManifest.description, "string");
  assert.ok(rootManifest.description.length > 0 && rootManifest.description.length < 250, "description under 250 chars");
  assert.ok(rootManifest.description.endsWith("."), "description ends with a period");
  assert.ok(!/[\p{Extended_Pictographic}]/u.test(rootManifest.description), "no emoji in description");
  assert.ok(!/^obsidian\b/i.test(rootManifest.description), "description does not start with Obsidian");

  // 2. Source hygiene: no innerHTML/outerHTML/insertAdjacentHTML, no console noise, no default hotkeys,
  //    no plugin name prefix in addCommand, and onunload cleans up timers/watchers without detaching leaves.
  const srcFiles = ["discover.ts", "load.ts", "main.ts", "model.ts", "views.ts"];
  for (const f of srcFiles) {
    const code = readRepo(`packages/obsidian/src/${f}`);
    assert.ok(!/\b(innerHTML|outerHTML|insertAdjacentHTML)\b/.test(code), `no HTML injection sink in ${f}`);
    assert.ok(!/\bconsole\.(log|debug|info)\b/.test(code), `no console noise in ${f}`);
    assert.ok(!/\bhotkeys\s*:/.test(code), `no default hotkeys in ${f}`);
  }
  const mainTs = readRepo("packages/obsidian/src/main.ts");
  assert.match(mainTs, /addCommand\(\{\s*id:\s*"open-scopes",\s*name:\s*"Open scopes"/, "command name uses sentence case without plugin prefix");
  const onunloadBlock = mainTs.slice(mainTs.indexOf("onunload(): void"), mainTs.indexOf("restartAutoRefresh(): void"));
  assert.ok(onunloadBlock.includes("this.stopAutoRefresh()") && onunloadBlock.includes("this.stopWatch?.()") && onunloadBlock.includes("window.clearInterval(this.pollTimer)"), "onunload cleans up watchers and timers");
  assert.ok(!onunloadBlock.includes(".detach()"), "onunload does not detach user workspace leaves");

  // 3. Disclosures in README.md and packages/obsidian/README.md + LICENSE at repo root.
  assert.ok(readRepo("LICENSE").includes("MIT License"), "LICENSE present at root");
  for (const doc of ["README.md", "packages/obsidian/README.md"]) {
    const text = readRepo(doc);
    assert.match(text, /isDesktopOnly/i, `${doc} discloses desktop-only`);
    assert.match(text, /outside the (current )?vault/i, `${doc} discloses outside-vault file access`);
    assert.match(text, /git fetch/i, `${doc} discloses git network fetches`);
  }

  // 4. Release workflow attaches main.js, manifest.json, and styles.css on v*.*.* tags.
  const workflow = readRepo(".github/workflows/release.yml");
  assert.ok(workflow.includes('RELEASE_TAG="${TAG_NAME#v}"'), "Obsidian release tag equals the manifest version, without v");
  assert.ok(workflow.includes('--target "$TARGET_SHA"'), "the numeric release tag points at the tested checkout");
  assert.ok(workflow.includes('Refusing to change existing release tag'), "a different commit cannot silently reuse a release tag");
  for (const asset of ["packages/obsidian/dist/plugin/main.js", "packages/obsidian/dist/plugin/manifest.json", "packages/obsidian/dist/plugin/styles.css"]) {
    assert.ok(workflow.includes(asset), `release workflow uploads ${asset}`);
  }
});

test("the plugin bundle has no update refresher: no GitHub tags fetch and no spawned process", () => {
  // Builds the real bundle the release ships; the CLI keeps its update check, the plugin only reads the cache.
  const root = new URL("../", import.meta.url);
  execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: root, stdio: "ignore" });
  const bundle = readFileSync(new URL("dist/plugin/main.js", root), "utf8");
  assert.ok(!bundle.includes("/tags?per_page"), "no release-tags fetch in main.js");
  assert.ok(!bundle.includes("REFRESH_SCRIPT"), "no refresher script in main.js");
  assert.ok(!/\.spawn\)\(|\bspawn\(/.test(bundle), "no spawn( in main.js");
  assert.ok(bundle.includes("cachedUpdateNotice"), "the update notice still reads the cache");
});
