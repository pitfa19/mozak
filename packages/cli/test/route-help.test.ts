import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { vaultTemp } from "../../core/test/vault-temp.ts";

// `mozak <route> --help` and the MOZAK_CONFIG default. Synthetic inventory in an isolated temp folder.
const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const roots: string[] = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));
const cli = (args: string[], env: Record<string, string> = {}) => {
  const base = { ...process.env, MOZAK_NO_UPDATE_CHECK: "1" };
  delete base.MOZAK_CONFIG;
  const r = spawnSync(process.execPath, ["--no-warnings", cliPath, ...args], { encoding: "utf8", timeout: 30000, env: { ...base, ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

test("mozak <route> --help prints that route's flags and exits 0", () => {
  const show = cli(["plan", "show", "--help"]);
  assert.equal(show.code, 0, show.err);
  assert.match(show.out, /^mozak plan show/m);
  for (const flag of ["--config", "--scope", "--plan", "--json"]) assert.ok(show.out.includes(flag), flag);
  assert.ok(!show.out.includes("--request"), "only this route's flags");
  const attach = cli(["spec", "attach", "-h"]);
  assert.equal(attach.code, 0, attach.err);
  assert.match(attach.out, /--request/);
  assert.match(attach.out, /^flags: --config VALUE --scope VALUE --request VALUE --commit --json$/m);
  assert.match(attach.out, /required: --config --scope --request/);
  const decide = cli(["review", "decide", "--scope", "x", "--help"]);
  assert.equal(decide.code, 0, decide.err);
  assert.match(decide.out, /--owner-ref/);
  const unknown = cli(["plan", "nope", "--help"]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /unknown route "plan nope"/);
});

test("MOZAK_CONFIG is the default for --config; an explicit --config wins", () => {
  const root = vaultTemp(join(process.env.TMPDIR ?? "/tmp", "mozak-cli-config-env-")); roots.push(root);
  const config = join(root, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v3", scopes: [] }));
  const missing = cli(["scopes", "--json"]);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /missing --config/);
  const fromEnv = cli(["scopes", "--json"], { MOZAK_CONFIG: config });
  assert.equal(fromEnv.code, 0, fromEnv.out + fromEnv.err);
  const explicit = cli(["scopes", "--json", "--config", join(root, "absent.json")], { MOZAK_CONFIG: config });
  assert.notEqual(explicit.code, 0, "explicit --config overrides MOZAK_CONFIG");
});
