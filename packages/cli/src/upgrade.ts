// `mozak upgrade`: move an installation to the newest tagged release of its source checkout.
// Order matters: every check and the whole build happen before the installation is touched, and a failed swap
// puts the old installation back. Old installations are kept as PREFIX.previous-<version>, never deleted.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, renameSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { compareVersions, highestRelease, installedVersion, parseVersion } from "@mozak/core";

export interface UpgradeArgs { prefix?: string; source?: string; vaults: string[]; check: boolean }
export interface UpgradeResult { exitCode: number; data: Record<string, unknown> }

class Refusal extends Error {
  readonly code: string;
  readonly exitCode: number;
  constructor(code: string, message: string, exitCode = 2) { super(message); this.code = code; this.exitCode = exitCode; }
}

const BUILD_TIMEOUT_MS = 15 * 60 * 1000;

function git(cwd: string, args: string[], timeout = 60_000): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout }).trim();
}

function tryGit(cwd: string, args: string[]): string | null {
  try { return git(cwd, args); } catch { return null; }
}

function run(cwd: string, cmd: string, args: string[]): { ok: boolean; output: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: BUILD_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return { ok: !r.error && r.status === 0, output: r.error ? String(r.error.message) : output.split("\n").slice(-15).join("\n") };
}

interface Installation { prefix: string; version: string; source: string | null }

function readInstallation(prefix: string): Installation {
  const path = join(prefix, "installation.json");
  let m: { format?: unknown; version?: unknown; source?: unknown };
  try { m = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Refusal("installation-unavailable", `no readable mozak installation at ${prefix} (missing ${path})`); }
  if (m.format !== "mozak.installation/v1" || typeof m.version !== "string" || !parseVersion(m.version)) {
    throw new Refusal("installation-unavailable", `${path} is not a mozak installation manifest`);
  }
  return { prefix, version: m.version, source: typeof m.source === "string" ? m.source : null };
}

function checkout(path: string): { root: string; origin: string } {
  if (!isAbsolute(path) || !existsSync(path)) throw new Refusal("source-unavailable", `source checkout ${path} does not exist`);
  const top = tryGit(path, ["rev-parse", "--show-toplevel"]);
  if (!top || realpathSync(top) !== realpathSync(path)) throw new Refusal("source-unavailable", `${path} is not the top of a git checkout`);
  const origin = tryGit(path, ["remote", "get-url", "origin"]);
  if (!origin) throw new Refusal("source-unavailable", `${path} has no origin remote to fetch releases from`);
  if (!existsSync(join(path, "scripts", "install.mjs"))) throw new Refusal("source-unavailable", `${path} is not a mozak checkout (no scripts/install.mjs)`);
  return { root: path, origin };
}

function freeName(base: string): string {
  if (!existsSync(base)) return base;
  for (let i = 2; ; i++) if (!existsSync(`${base}-${i}`)) return `${base}-${i}`;
}

function installedCliVersion(prefix: string): string | null {
  const r = spawnSync(process.execPath, [join(prefix, "bin", "mozak"), "--version"], { encoding: "utf8", timeout: 30_000, env: { ...process.env, MOZAK_NO_UPDATE_CHECK: "1" } });
  return r.status === 0 ? r.stdout.trim() : null;
}

function install(source: string, prefix: string): { ok: boolean; output: string } {
  return run(source, process.execPath, [join(source, "scripts", "install.mjs"), "--prefix", prefix, "--json"]);
}

export function upgrade(args: UpgradeArgs): UpgradeResult {
  const base: Record<string, unknown> = { status: "", from: null, to: null, prefix: null, previous: null, source: null, vaults: [], issues: [] };
  const issues: Array<Record<string, unknown>> = [];
  try {
    // 1. The installation and its source checkout.
    let prefix: string;
    if (args.prefix !== undefined) {
      if (!isAbsolute(args.prefix)) throw new Refusal("invalid-input", "--prefix must be an absolute path");
      prefix = resolve(args.prefix);
    } else {
      const here = installedVersion();
      if (!here) throw new Refusal("installation-unavailable", "this mozak is not running from an installation; pass --prefix PATH");
      prefix = here.prefix;
    }
    const inst = readInstallation(prefix);
    base.prefix = prefix;
    base.from = inst.version;
    const sourcePath = args.source !== undefined ? resolve(args.source) : inst.source;
    if (!sourcePath) throw new Refusal("source-unavailable", `${prefix}/installation.json does not record its source checkout; pass --source PATH`);
    const src = checkout(sourcePath);
    if (args.source !== undefined && inst.source && inst.source !== src.root && existsSync(inst.source)) {
      const recorded = tryGit(inst.source, ["remote", "get-url", "origin"]);
      if (recorded && recorded !== src.origin) throw new Refusal("source-unavailable", `--source origin ${src.origin} differs from the installed checkout's origin ${recorded}`);
    }
    base.source = src.root;

    // Vaults are named, never guessed, and checked before anything changes.
    const vaults = args.vaults.map((v) => resolve(v));
    for (const v of vaults) {
      if (!existsSync(v) || !statSync(v).isDirectory() || !existsSync(join(v, ".obsidian"))) throw new Refusal("invalid-input", `${v} is not an Obsidian vault (no .obsidian folder)`);
    }

    // 2. The newest release tag.
    const fetched = run(src.root, "git", ["fetch", "--tags", "--quiet", "origin"]);
    if (!fetched.ok) issues.push({ code: "fetch-failed", message: `could not fetch tags from ${src.origin}; using the tags already in the checkout. ${fetched.output}` });
    const latest = highestRelease((tryGit(src.root, ["tag", "--list", "v*"]) ?? "").split("\n").filter(Boolean));
    base.to = latest;
    if (!latest || compareVersions(latest, inst.version) <= 0) {
      return { exitCode: 0, data: { ...base, status: "up-to-date", to: inst.version, latest, issues } };
    }

    // 3. A dirty checkout is the owner's work in progress: never touched.
    const dirty = tryGit(src.root, ["status", "--porcelain", "--untracked-files=no"]);
    if (dirty === null || dirty !== "") {
      throw new Refusal("source-dirty", `${src.root} has uncommitted changes to tracked files; commit or stash them, then rerun`, 3);
    }

    // 4. --check stops before any change.
    if (args.check) return { exitCode: 0, data: { ...base, status: "checked", installed: inst.version, latest, issues } };

    // 5. Build the tag in the checkout, then return the checkout to where it was.
    const branch = tryGit(src.root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const priorRef = branch ?? git(src.root, ["rev-parse", "HEAD"]);
    const restore = () => {
      const r = run(src.root, "git", ["checkout", "--quiet", priorRef]);
      if (!r.ok) issues.push({ code: "checkout-not-restored", message: `could not return ${src.root} to ${priorRef}: ${r.output}` });
    };
    const tag = `v${latest}`;
    const co = run(src.root, "git", ["checkout", "--quiet", "--detach", tag]);
    if (!co.ok) throw new Refusal("build-failed", `git checkout ${tag} failed: ${co.output}`);
    try {
      const declared = JSON.parse(readFileSync(join(src.root, "package.json"), "utf8")).version;
      if (declared !== latest) throw new Refusal("build-failed", `${tag} declares version ${declared}, not ${latest}`);
      // The release's own `build` script builds everything, the Obsidian plugin included.
      // Dependencies are installed exactly from the release's lockfile; a release without one has none to install.
      const steps: Array<[string, string[]]> = [];
      if (existsSync(join(src.root, "package-lock.json"))) steps.push(["npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]]);
      steps.push(["npm", ["run", "build"]]);
      for (const [cmd, a] of steps) {
        const r = run(src.root, cmd, a);
        if (!r.ok) throw new Refusal("build-failed", `${cmd} ${a.join(" ")} failed at ${tag}; the installation is unchanged.\n${r.output}`);
      }

      // 6. Swap. The installer writes the installation's absolute path into the skill and wrappers, so the new
      //    release installs at the same path: the old installation moves aside first and any failure moves it back.
      const previous = freeName(`${prefix}.previous-${inst.version}`);
      renameSync(prefix, previous);
      const installed = install(src.root, prefix);
      const version = installed.ok ? installedCliVersion(prefix) : null;
      if (!installed.ok || version !== latest) {
        let kept: string | null = null;
        if (existsSync(prefix)) { kept = freeName(`${prefix}.failed-${randomUUID().slice(0, 8)}`); renameSync(prefix, kept); }
        renameSync(previous, prefix);
        throw new Refusal("install-failed", `installing ${tag} failed, so the previous installation was put back${kept ? ` (the failed attempt is kept at ${kept})` : ""}. ${installed.output}`);
      }
      base.previous = previous;

      // 7. The Obsidian plugin, into each named vault, from the build just made.
      const results: Array<Record<string, unknown>> = [];
      for (const v of vaults) {
        const r = run(src.root, process.execPath, [join(src.root, "scripts", "install-obsidian-plugin.mjs"), v]);
        results.push({ vault: v, status: r.ok ? "installed" : "failed", ...(r.ok ? {} : { message: r.output }) });
      }
      base.vaults = results;
      const failed = results.filter((r) => r.status !== "installed").length;
      return { exitCode: failed > 0 ? 5 : 0, data: { ...base, status: "upgraded", to: latest, issues: [...issues, ...(failed > 0 ? [{ code: "plugin-install-failed", message: `${failed} vault(s) did not get the new plugin; rerun with --vault` }] : [])] } };
    } finally {
      restore();
    }
  } catch (err) {
    if (err instanceof Refusal) return { exitCode: err.exitCode, data: { ...base, status: err.code, issues: [...issues, { code: err.code, message: err.message }] } };
    throw err;
  }
}

/** Version of the installation this code runs from, else of this CLI package. */
export function runningVersion(): string {
  const inst = installedVersion();
  if (inst) return inst.version;
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  return pkg.version;
}
