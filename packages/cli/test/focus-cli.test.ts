import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, world } from "../../core/test/annotations-fixture.ts";

// Real CLI subprocess runs against synthetic temp scopes only. Focus edits only the scratch inventory.
const cliPath = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "dist", "index.js");
after(cleanup);

function cli(args: string[]) {
  if (!existsSync(cliPath)) throw new Error(`built CLI missing at ${cliPath}; run "npm run build" first`);
  const r = spawnSync(process.execPath, ["--no-warnings", cliPath, ...args], { encoding: "utf8", timeout: 30000 });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

test("CLI: focus add, list and remove on a scratch inventory; mozak.json and mozak.md never change", () => {
  const w = world(["alpha", "beta"]);
  w.propose("alpha", "a1"); w.propose("beta", "b1");
  const before = w.bytes("alpha");
  const add = cli(["focus", "add", "--config", w.config, "--scope", "alpha", "--plan", "a1"]);
  assert.equal(add.code, 0, add.out + add.err);
  assert.deepEqual(JSON.parse(add.out), { status: "ok", scope: "alpha", focus: ["a1"], changed: true });
  assert.deepEqual(JSON.parse(readFileSync(w.config, "utf8")).scopes[0].focus, ["a1"]);
  const all = cli(["focus", "list", "--config", w.config, "--json"]);
  assert.equal(all.code, 0, all.err);
  assert.deepEqual(JSON.parse(all.out).focus, { alpha: ["a1"], beta: [] });
  const one = cli(["focus", "list", "--config", w.config, "--scope", "alpha"]);
  assert.equal(one.code, 0, one.err);
  assert.match(one.out, /^alpha: a1$/m);
  assert.doesNotMatch(one.out, /beta/);
  const remove = cli(["focus", "remove", "--config", w.config, "--scope", "alpha", "--plan", "a1"]);
  assert.equal(remove.code, 0, remove.err);
  assert.deepEqual(JSON.parse(remove.out).focus, []);
  assert.deepEqual(w.bytes("alpha"), before);
});

test("CLI: focus add refuses an unknown plan with exit 2 and needs --scope and --plan", () => {
  const w = world(["alpha"]);
  w.propose("alpha", "a1");
  const bad = cli(["focus", "add", "--config", w.config, "--scope", "alpha", "--plan", "nope"]);
  assert.equal(bad.code, 2);
  assert.equal(JSON.parse(bad.out).status, "plan-not-found");
  assert.equal(cli(["focus", "add", "--config", w.config, "--scope", "alpha"]).code, 2);
  assert.equal(cli(["focus", "list", "--config", w.config, "--scope", "gamma"]).code, 2);
});
