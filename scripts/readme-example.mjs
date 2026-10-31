#!/usr/bin/env node
// Reproduces the short example in README.md on a throwaway scope in a temp folder.
// Run after `npm run build`: node scripts/readme-example.mjs
// It never touches a real inventory. Synthetic data only. The temp folder is removed at the end.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../packages/cli/dist/index.js", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "mozak-readme-example-"));
const at = new Date(Date.now() - 60_000).toISOString();
let seq = 0;

function mozak(args, { json = false } = {}) {
  const p = spawnSync(process.execPath, [cli, ...args, "--config", join(root, "mozak-inventory.json"), ...(json ? ["--json"] : [])], { encoding: "utf8", timeout: 30_000 });
  return { code: p.status, out: (p.stdout ?? "") + (p.stderr ?? "") };
}
function request(body) {
  const path = join(root, `request-${seq++}.json`);
  writeFileSync(path, JSON.stringify(body));
  return path;
}
function show(label, args, r) {
  console.log(`$ mozak ${args.join(" ")}   # ${label}`);
  let text = r.out.trimEnd();
  try {
    // Write routes answer in JSON. Keep only the lines a reader needs.
    const j = JSON.parse(text);
    text = [`status: ${j.status}`, `committed: ${j.committed}`, ...(j.issues ?? []).map((i) => `${i.code}: ${i.message}`)].join("\n");
  } catch { /* human-readable output, print as is */ }
  console.log(text);
  console.log(`(exit ${r.code})\n`);
}

try {
  const app = join(root, "my-app");
  mkdirSync(app);
  writeFileSync(join(app, "README.md"), "# my-app\n");
  writeFileSync(join(app, "AGENTS.md"), "# Agents\n");
  writeFileSync(join(root, "mozak-inventory.json"), JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "my-app", root: "./my-app" }] }));

  const init = mozak(["scope", "init", "--scope", "my-app", "--request", request({ operationId: "init-my-app", scopeId: "my-app", kind: "project", title: "my-app", expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic-owner:readme-example", ownerMessageAt: at })], { json: true });
  if (init.code !== 0) throw new Error(`scope init failed: ${init.out}`);

  const ctx = mozak(["context", "--scope", "my-app"], { json: true });
  const expected = JSON.parse(ctx.out).snapshot;
  const content = (title, statement) => ({
    title, purpose: "Example plan for the README", rationale: "Synthetic example",
    outcomes: [{ id: "works", statement, acceptance: "objective", criterion: "A test passes" }],
    constraints: [], nonGoals: [], questions: [],
    sources: [{ id: "example", locator: "synthetic:readme-example", anchor: null, observedAt: at, version: null, limitations: ["Synthetic example"] }],
  });
  // Two agents read the same snapshot, then both propose.
  const a = request({ operationId: `op-a-${Date.now()}`, scopeId: "my-app", expected, action: "propose", payload: { planId: "dark-mode", content: content("Add dark mode", "The app has a dark theme") } });
  const b = request({ operationId: `op-b-${Date.now()}`, scopeId: "my-app", expected, action: "propose", payload: { planId: "csv-export", content: content("Export to CSV", "Users can export a table as CSV") } });
  show("agent A proposes", ["plan", "propose", "--scope", "my-app", "--request", "a.json"], mozak(["plan", "propose", "--scope", "my-app", "--request", a]));
  show("agent B proposes from the same, now old, snapshot", ["plan", "propose", "--scope", "my-app", "--request", "b.json"], mozak(["plan", "propose", "--scope", "my-app", "--request", b]));
  show("what is in the plan now", ["plans", "--scope", "my-app"], mozak(["plans", "--scope", "my-app"]));
} finally {
  rmSync(root, { recursive: true, force: true });
}
