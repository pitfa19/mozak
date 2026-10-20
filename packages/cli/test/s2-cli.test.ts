import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, NOW, world } from "../../core/test/annotations-fixture.ts";
import { readScope } from "../../core/src/index.ts";

// Real CLI subprocess runs against synthetic temp scopes only. Never a real inventory.
const cliPath = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "dist", "index.js");
after(cleanup);

function cli(args: string[], env: Record<string, string> = {}) {
  if (!existsSync(cliPath)) throw new Error(`built CLI missing at ${cliPath}; run "npm run build" first`);
  const r = spawnSync(process.execPath, ["--no-warnings", cliPath, ...args], { encoding: "utf8", timeout: 30000, env: { ...process.env, ...env } });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

test("CLI: recover is an owner route that needs a request file naming the lock", () => {
  const w = world();
  const lock = join(w.entries.alpha.root, ".mozak-write-lock");
  mkdirSync(lock);
  writeFileSync(join(lock, "owner.json"), JSON.stringify({ token: "cli-tok", pid: 99, host: "synthetic-other-host", acquiredAt: NOW }));
  const check = cli(["check", "--config", w.config, "--scope", "alpha"]);
  assert.equal(check.code, 3);
  assert.equal(JSON.parse(check.out).issues.find((i: { code: string }) => i.code === "write-lock-stuck").lock.verdict, "other-host");
  assert.equal(cli(["recover", "--config", w.config, "--scope", "alpha"]).code, 2, "the request file is required");
  const request = join(w.base, "recover.json");
  writeFileSync(request, JSON.stringify({ requestId: "cli-recover", scopeId: "alpha", lock: { token: "cli-tok", host: "synthetic-other-host", pid: 99 }, ownerRef: "synthetic:owner", ownerMessageAt: NOW }));
  const out = cli(["recover", "--config", w.config, "--scope", "alpha", "--request", request]);
  assert.equal(out.code, 0, out.out + out.err);
  assert.equal(JSON.parse(out.out).status, "ok");
  assert.equal(existsSync(lock), false);
});

test("CLI: plan prune --rejected removes listed rejected plans and requires --rejected", () => {
  const w = world();
  w.propose("alpha", "keep");
  w.propose("alpha", "gone", {}, false);
  w.reject("alpha", "gone");
  const request = join(w.base, "prune.json");
  writeFileSync(request, JSON.stringify({ operationId: "cli-prune", scopeId: "alpha", expected: readScope(w.entries.alpha).snapshot, planIds: ["gone"], ownerRef: "synthetic:owner", ownerMessageAt: NOW }));
  assert.equal(cli(["plan", "prune", "--config", w.config, "--scope", "alpha", "--request", request]).code, 2);
  const out = cli(["plan", "prune", "--rejected", "--config", w.config, "--scope", "alpha", "--request", request]);
  assert.equal(out.code, 0, out.out + out.err);
  assert.deepEqual(JSON.parse(out.out).result, { action: "prune-rejected", ids: ["gone"] });
  assert.deepEqual(readScope(w.entries.alpha).state.plans.map((p) => p.id), ["keep"]);
});

test("CLI: check --history validates N; sync of a local scope outside git explains itself", () => {
  const w = world();
  assert.equal(cli(["check", "--config", w.config, "--scope", "alpha", "--history", "abc"]).code, 2);
  const ok = cli(["check", "--config", w.config, "--scope", "alpha", "--history", "5"]);
  assert.equal(ok.code, 0, ok.out + ok.err);
  assert.equal(JSON.parse(ok.out).history.available, false);
  const sync = cli(["sync", "--config", w.config, "--scope", "alpha"]);
  assert.equal(sync.code, 2);
  assert.match(sync.out, /local .*not-in-git/);
  const json = cli(["sync", "--config", w.config, "--local", "--json"]);
  assert.equal(JSON.parse(json.out).local[0].status, "not-in-git");
});
