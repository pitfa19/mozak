import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, world } from "../../core/test/annotations-fixture.ts";

// Real CLI subprocess runs of `mozak scope move` against synthetic temp scopes and a scratch inventory only.
const cliPath = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "dist", "index.js");
after(cleanup);

function cli(args: string[]) {
  if (!existsSync(cliPath)) throw new Error(`built CLI missing at ${cliPath}; run "npm run build" first`);
  const r = spawnSync(process.execPath, ["--no-warnings", cliPath, ...args], { encoding: "utf8", timeout: 30000 });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}
const OWNER = ["--owner-ref", "synthetic:owner", "--owner-message-at", "2026-11-01T17:25:00.000Z", "--reason", "Synthetic move"];

/** alpha lives outside any vault; base/vault is a vault (it has a .obsidian folder). */
function setup() {
  const w = world(["alpha"]);
  w.propose("alpha", "a1");
  mkdirSync(join(w.base, "vault", ".obsidian"), { recursive: true });
  return w;
}

test("CLI: scope move --dry-run shows files and the new entry; the real run moves; the rerun changes nothing", () => {
  const w = setup();
  const text = readFileSync(w.config, "utf8");
  const dry = cli(["scope", "move", "--config", w.config, "--scope", "alpha", "--to", "vault/alpha", "--dry-run", ...OWNER]);
  assert.equal(dry.code, 0, dry.out + dry.err);
  assert.match(dry.out, /status: dry-run \(nothing written\)/);
  assert.match(dry.out, /copy mozak\.json/);
  assert.match(dry.out, /new entry: \{"id":"alpha","root":"vault\/alpha"\}/);
  assert.equal(readFileSync(w.config, "utf8"), text);
  const real = cli(["scope", "move", "--config", w.config, "--scope", "alpha", "--to", "vault/alpha", "--json", ...OWNER]);
  assert.equal(real.code, 0, real.out + real.err);
  assert.equal(JSON.parse(real.out).status, "ok");
  assert.deepEqual(JSON.parse(readFileSync(w.config, "utf8")).scopes, [{ id: "alpha", root: "vault/alpha" }]);
  assert.ok(readFileSync(join(w.base, "vault", "alpha", "mozak.json")).equals(readFileSync(join(w.base, "alpha", "mozak.json"))));
  const again = cli(["scope", "move", "--config", w.config, "--scope", "alpha", "--to", "vault/alpha", ...OWNER]);
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /already done/);
});

test("CLI: scope move needs the owner flags and exactly one of --to or --drop, and refuses a target outside a vault", () => {
  const w = setup();
  const missing = cli(["scope", "move", "--config", w.config, "--scope", "alpha", "--to", "vault/alpha"]);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /missing --owner-ref/);
  const outside = cli(["scope", "move", "--config", w.config, "--scope", "alpha", "--to", "elsewhere", ...OWNER]);
  assert.equal(outside.code, 2);
  assert.equal(JSON.parse(outside.out).status, "move-target-outside-vault");
  const both = cli(["scope", "move", "--config", w.config, "--scope", "alpha", "--to", "vault/x", "--drop", ...OWNER]);
  assert.equal(both.code, 2);
  // The route is listed in help.
  assert.match(cli(["--help"]).out, /mozak scope move --scope ID/);
});

test("CLI: scope move --drop removes a 0-plan entry and refuses a scope with plans", () => {
  const w = world(["alpha", "empty"]);
  w.propose("alpha", "a1");
  const r = cli(["scope", "move", "--config", w.config, "--scope", "alpha", "--drop", ...OWNER]);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.out).status, "drop-refused-has-plans");
  const ok = cli(["scope", "move", "--config", w.config, "--scope", "empty", "--drop", ...OWNER]);
  assert.equal(ok.code, 0, ok.out + ok.err);
  assert.match(ok.out, /drop empty: remove its inventory entry/);
  assert.deepEqual(JSON.parse(readFileSync(w.config, "utf8")).scopes.map((s: { id: string }) => s.id), ["alpha"]);
  assert.ok(existsSync(join(w.base, "empty", "mozak.json")));
});
