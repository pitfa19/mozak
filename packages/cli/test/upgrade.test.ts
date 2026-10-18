import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// `mozak upgrade` end to end, offline: a fake MOZAK source checkout copied from this repo's built product, with a
// bare repo as its origin and release tags made here. The real built CLI upgrades a real installation.

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "..", "..", "..");
const cliPath = resolve(here, "..", "dist", "index.js");
const scratch = realpathSync(process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR ?? tmpdir());
const roots: string[] = [];

after(() => {
  for (const root of roots) {
    if (!root.startsWith(scratch + "/") || !root.includes("/mozak-upgrade-")) throw new Error(`refusing to remove ${root}`);
    rmSync(root, { recursive: true, force: true });
  }
});

const ENV = {
  PATH: process.env.PATH ?? "",
  HOME: "",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
  MOZAK_NO_UPDATE_CHECK: "1",
  npm_config_update_notifier: "false",
};

function sh(cwd: string, cmd: string, args: string[], env = ENV) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed in ${cwd}: ${r.stdout}${r.stderr}`);
  return r.stdout.trim();
}

const PRODUCT = [
  "LICENSE", "scripts/install.mjs", "scripts/install-obsidian-plugin.mjs", "skills/mozak",
  ...["core", "cli", "mcp"].flatMap((p) => [`packages/${p}/package.json`, `packages/${p}/dist`]),
  "packages/obsidian/package.json", "packages/obsidian/dist/plugin",
];

function setVersion(source: string, version: string, buildScript = "node -e 0"): void {
  const edit = (rel: string, fn: (j: Record<string, any>) => void) => {
    const p = join(source, rel);
    const j = JSON.parse(readFileSync(p, "utf8"));
    fn(j);
    writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`);
  };
  edit("package.json", (j) => { j.version = version; j.scripts = { build: buildScript }; });
  for (const p of ["core", "cli", "mcp", "obsidian"]) edit(`packages/${p}/package.json`, (j) => { j.version = version; if (j.dependencies?.["@mozak/core"]) j.dependencies["@mozak/core"] = version; });
  edit("packages/obsidian/dist/plugin/manifest.json", (j) => { j.version = version; });
}

function release(source: string, version: string, buildScript?: string): void {
  setVersion(source, version, buildScript);
  sh(source, "git", ["add", "-A"]);
  sh(source, "git", ["commit", "-qm", `release ${version}`]);
  sh(source, "git", ["tag", "-a", `v${version}`, "-m", `v${version}`]);
  sh(source, "git", ["push", "-q", "origin", "main", "--tags"]);
}

function fixture() {
  const root = mkdtempSync(join(scratch, "mozak-upgrade-"));
  roots.push(root);
  const origin = join(root, "origin.git");
  const source = join(root, "source");
  const prefix = join(root, "share", "mozak");
  const vault = join(root, "vault");
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  mkdirSync(join(root, "share"));
  sh(root, "git", ["init", "-q", "--bare", "-b", "main", origin]);
  mkdirSync(source);
  for (const rel of [...PRODUCT, "package.json"]) cpSync(join(repo, rel), join(source, rel), { recursive: true });
  writeFileSync(join(source, ".gitignore"), "node_modules\n");
  sh(source, "git", ["init", "-q", "-b", "main"]);
  sh(source, "git", ["remote", "add", "origin", origin]);
  release(source, "0.2.0");
  const env = { ...ENV, HOME: root };
  sh(source, process.execPath, ["scripts/install.mjs", "--prefix", prefix, "--json"], env);
  return { root, origin, source, prefix, vault, env };
}

function upgrade(f: ReturnType<typeof fixture>, extra: string[] = []) {
  const r = spawnSync(process.execPath, ["--no-warnings", cliPath, "upgrade", "--prefix", f.prefix, ...extra], { env: f.env, encoding: "utf8", timeout: 300_000 });
  let data: Record<string, any> = {};
  try { data = JSON.parse(r.stdout); } catch { /* asserted by callers */ }
  return { code: r.status, data, err: r.stderr };
}

function installedVersion(prefix: string): string {
  return sh(prefix, process.execPath, [join(prefix, "bin", "mozak"), "--version"]);
}

test("upgrade: up-to-date, --check, dirty refusal, upgrade with plugin, previous kept, build failure leaves the install working", () => {
  const f = fixture();
  assert.equal(installedVersion(f.prefix), "0.2.0");
  const manifest = JSON.parse(readFileSync(join(f.prefix, "installation.json"), "utf8"));
  assert.equal(realpathSync(manifest.source), realpathSync(f.source), "the installer records its source checkout");

  // Nothing newer than the installed release.
  let r = upgrade(f);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.data.status, "up-to-date");

  // A newer tag appears on origin. The local checkout moves back to an older commit to prove tags are fetched.
  release(f.source, "0.3.0");
  sh(f.source, "git", ["tag", "-d", "v0.3.0"]);
  r = upgrade(f, ["--check"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.data.status, "checked");
  assert.equal(r.data.installed, "0.2.0");
  assert.equal(r.data.latest, "0.3.0", "tags are fetched from origin");
  assert.equal(installedVersion(f.prefix), "0.2.0", "--check changes nothing");

  // A dirty checkout is refused before anything changes.
  writeFileSync(join(f.source, "LICENSE"), "edited\n");
  r = upgrade(f);
  assert.equal(r.code, 3);
  assert.equal(r.data.status, "source-dirty");
  assert.equal(installedVersion(f.prefix), "0.2.0");
  sh(f.source, "git", ["checkout", "--", "LICENSE"]);

  // A vault that is not a vault is refused up front.
  r = upgrade(f, ["--vault", join(f.root, "share")]);
  assert.equal(r.code, 2);
  assert.equal(r.data.status, "invalid-input");

  // The upgrade itself.
  const headBefore = sh(f.source, "git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  r = upgrade(f, ["--vault", f.vault]);
  assert.equal(r.code, 0, `${r.err}\n${JSON.stringify(r.data, null, 2)}`);
  assert.equal(r.data.status, "upgraded");
  assert.equal(r.data.from, "0.2.0");
  assert.equal(r.data.to, "0.3.0");
  assert.equal(installedVersion(f.prefix), "0.3.0");
  assert.equal(r.data.previous, `${f.prefix}.previous-0.2.0`);
  assert.equal(installedVersion(r.data.previous), "0.2.0", "the previous installation is kept and still runs");
  assert.deepEqual(r.data.vaults, [{ vault: f.vault, status: "installed" }]);
  assert.equal(JSON.parse(readFileSync(join(f.vault, ".obsidian", "plugins", "mozak", "manifest.json"), "utf8")).version, "0.3.0");
  assert.equal(sh(f.source, "git", ["rev-parse", "--abbrev-ref", "HEAD"]), headBefore, "the checkout is returned to its branch");

  // Running again is a no-op.
  r = upgrade(f);
  assert.equal(r.data.status, "up-to-date");

  // A release whose build fails leaves the working installation untouched.
  release(f.source, "0.4.0", "node -e process.exit(1)");
  r = upgrade(f);
  assert.equal(r.code, 2);
  assert.equal(r.data.status, "build-failed");
  assert.equal(installedVersion(f.prefix), "0.3.0");
  assert.equal(existsSync(`${f.prefix}.previous-0.3.0`), false, "nothing was moved aside");
  assert.equal(sh(f.source, "git", ["rev-parse", "--abbrev-ref", "HEAD"]), headBefore);
  assert.deepEqual(readdirSync(join(f.root, "share")).sort(), ["mozak", "mozak.previous-0.2.0"]);
});

test("upgrade refuses an installation without a recorded or valid source checkout", () => {
  const f = fixture();
  const notCheckout = upgrade(f, ["--source", join(f.root, "vault")]);
  assert.equal(notCheckout.code, 2);
  assert.equal(notCheckout.data.status, "source-unavailable");
  const missing = upgrade({ ...f, prefix: join(f.root, "nope") });
  assert.equal(missing.data.status, "installation-unavailable");
  const relative = spawnSync(process.execPath, ["--no-warnings", cliPath, "upgrade", "--prefix", "relative/path"], { env: f.env, encoding: "utf8" });
  assert.equal(JSON.parse(relative.stdout).status, "invalid-input");
});
