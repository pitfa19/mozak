import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupS6, s6world } from "../../core/test/s6-fixture.ts";

// Real CLI subprocess runs against synthetic temp vaults only.
const cliPath = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "dist", "index.js");
after(cleanupS6);

function cli(args: string[]) {
  if (!existsSync(cliPath)) throw new Error(`built CLI missing at ${cliPath}; run "npm run build" first`);
  const r = spawnSync(process.execPath, ["--no-warnings", cliPath, ...args], { encoding: "utf8", timeout: 30000 });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

test("CLI: similar, locators and plans-md on synthetic vaults", () => {
  const w = s6world({ lab: "vault/research/lab", co: "company" }, { repos: ["vault", "company"] });
  mkdirSync(join(w.base, "vault", "research", "notes"), { recursive: true });
  writeFileSync(join(w.base, "vault", "research", "notes", "plan.md"), "# Lab notes\n\nBody.\n");
  w.propose("lab", "cedar-export", { title: "Cedar export pipeline reports", sources: [{ locator: "research/notes/plan.md" }] });
  w.propose("co", "cedar-copy", { title: "Cedar export pipeline reports" });

  const similar = cli(["similar", "--config", w.config, "--all"]);
  assert.equal(similar.code, 0, similar.err);
  const report = JSON.parse(similar.out).similar;
  assert.deepEqual(report.pairs.map((p: { label: string; a: { planId: string }; b: { planId: string } }) => [p.label, p.a.planId, p.b.planId]), [["duplicate", "cedar-copy", "cedar-export"]]);
  assert.equal(cli(["similar", "--config", w.config]).code, 2, "needs --scope or --all");

  const loc = cli(["locators", "--config", w.config, "--scope", "lab"]);
  assert.equal(loc.code, 0, loc.err);
  const data = JSON.parse(loc.out);
  assert.deepEqual(data.counts, { resolved: 1 });
  assert.equal(data.locators[0].title, "Lab notes");

  const printed = cli(["plans-md", "--config", w.config, "--print"]);
  assert.equal(printed.code, 0, printed.err);
  assert.match(printed.out, /<!-- .*company\/plans\.md -->\n<!-- mozak:plans-index v1/);
  assert.match(printed.out, /- open: Cedar export pipeline reports \(`cedar-export`\)/);
  assert.ok(!existsSync(join(w.base, "vault", "plans.md")));
  const wrote = cli(["plans-md", "--config", w.config]);
  assert.equal(wrote.code, 0, wrote.err);
  assert.deepEqual(JSON.parse(wrote.out).files.map((f: { result: string }) => f.result), ["written", "written"]);
  assert.ok(existsSync(join(w.base, "vault", "plans.md")));
});
