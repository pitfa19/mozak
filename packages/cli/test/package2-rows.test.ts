import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Real built-CLI test for human plan rows. One plan can appear as direction, outcome, and implementation
// awaiting rows at once. Each row must carry its own explicit purpose label so the rows are not ambiguous.
// Owner and agent calls use synthetic references, labelled as fixtures. No real owner message is claimed.

const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR;
if (!scratch) throw new Error("scratch directory required");
const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const ownerAt = "2026-10-12T08:00:00.000Z";

const content = (title: string) => ({
  title,
  purpose: "Preserve agreed meaning",
  outcomes: [{ id: "o1", statement: "Fresh context is sufficient", acceptance: "owner", criterion: "Owner accepts" }],
  constraints: [],
  nonGoals: [],
  rationale: "Avoid lost decisions",
  questions: [],
  sources: [{ id: "source", locator: "synthetic:source", anchor: null, observedAt: ownerAt, version: "fixture-v1", limitations: ["Synthetic fixture"] }],
});

function fixture() {
  const root = mkdtempSync(join(scratch!, "mozak-rows-"));
  roots.push(root);
  const path = join(root, "one");
  mkdirSync(path);
  writeFileSync(join(path, "README.md"), "# readme\n");
  writeFileSync(join(path, "AGENTS.md"), "# agents\n");
  const config = join(root, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v2", scopes: [{ id: "one", root: "./one" }] }));
  let seq = 0;
  const run = (args: string[]) => spawnSync(process.execPath, ["--no-warnings", cliPath, ...args, "--config", config, "--json"], { encoding: "utf8", timeout: 15000 });
  // Human rendering is the default output of plans. The machine contract is --json, so this runner omits it.
  const human = (args: string[]) => spawnSync(process.execPath, ["--no-warnings", cliPath, ...args, "--config", config], { encoding: "utf8", timeout: 15000 });
  const request = (args: string[], body: object) => {
    const file = join(root, `request-${seq++}.json`);
    writeFileSync(file, JSON.stringify(body));
    return run([...args, "--request", file]);
  };
  const snapshot = () => JSON.parse(run(["context", "--scope", "one"]).stdout).snapshot;
  return { root, config, run, human, request, snapshot, seq: () => seq };
}

test("package 2 rows: one plan with direction, outcome and implementation rows labels each purpose in human output", () => {
  const f = fixture();
  const init = f.request(["scope", "init", "--scope", "one"], { operationId: "init-one", scopeId: "one", kind: "project", title: "one", expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic-owner:init", ownerMessageAt: ownerAt });
  assert.equal(init.status, 0, init.stdout + init.stderr);

  const proposed = f.request(["plan", "propose", "--scope", "one"], { operationId: "op-propose", scopeId: "one", expected: f.snapshot(), action: "propose", payload: { planId: "p", content: content("A") } });
  assert.equal(proposed.status, 0, proposed.stdout + proposed.stderr);

  const plain = f.human(["plans", "--scope", "one"]);
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
  // Pending direction is the only awaiting row here. The label must appear, and the title must remain.
  assert.match(plain.stdout, /awaiting \(1\)/);
  assert.match(plain.stdout, /- A  \[p\]/);
  assert.match(plain.stdout, /review: direction approval/);
});
