// `mozak doctor`: checks that an installation, its agent connections, the inventory and the Obsidian plugin fit
// together, and gives the exact command that fixes each problem. `--fix` performs only the safe fixes: skill links,
// missing ~/.local/bin wrappers, and an outdated plugin copy. It never edits MCP config, the inventory or plans.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { cachedUpdateNotice, executeOperation, installedVersion, loadInventory, npmInstall, vaultPluginDir } from "@mozak/core";

export type CheckState = "ok" | "warn" | "fail";
export interface Check { id: string; state: CheckState; message: string; fix?: string; fixed?: string }
export interface DoctorArgs { config?: string; fix: boolean; prefix?: string; home?: string; env?: NodeJS.ProcessEnv }

const NODE_MIN = [24, 11, 0] as const;
const SKILL_DIRS = [".claude/skills", ".jcode/skills", ".codex/skills"];
const MAX_VAULT_DEPTH = 3;

function nodeInRange(v: string): boolean {
  const p = v.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) if (p[i] !== NODE_MIN[i]) return (p[i] ?? 0) > NODE_MIN[i];
  return true;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function freeName(base: string): string {
  if (!existsSync(base) && !isLink(base)) return base;
  for (let i = 2; ; i++) if (!existsSync(`${base}-${i}`) && !isLink(`${base}-${i}`)) return `${base}-${i}`;
}

function isLink(path: string): boolean {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}

function sameTarget(a: string, b: string): boolean {
  try { return realpathSync(a) === realpathSync(b); } catch { return false; }
}

/** Every file the installation manifest names still has its recorded bytes and mode. */
function verifyInstallation(prefix: string): string | null {
  let m: { files?: Array<{ path: string; sha256: string; executable: boolean }> };
  try { m = JSON.parse(readFileSync(join(prefix, "installation.json"), "utf8")) as typeof m; } catch { return "installation.json is missing or unreadable"; }
  if (!Array.isArray(m.files)) return "installation.json has no file list";
  for (const f of m.files) {
    const p = join(prefix, f.path);
    try {
      if (sha256(p) !== f.sha256) return `${f.path} differs from the installed release`;
      if (((statSync(p).mode & 0o111) !== 0) !== f.executable) return `${f.path} has a changed executable bit`;
    } catch {
      return `${f.path} is missing`;
    }
  }
  return null;
}

function runs(prefix: string, bin: string, args: string[], input?: string): boolean {
  const r = spawnSync(process.execPath, [join(prefix, "bin", bin), ...args], { encoding: "utf8", timeout: 20_000, input, env: { ...process.env, MOZAK_NO_UPDATE_CHECK: "1" } });
  return r.status === 0 && (bin !== "mozak-mcp" || r.stdout.includes('"serverInfo"'));
}

/** MCP handshake against an empty inventory in a temporary folder, removed afterwards. */
function mcpAnswers(prefix: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "mozak-doctor-"));
  try {
    const inventory = join(dir, "inventory.json");
    writeFileSync(inventory, JSON.stringify({ format: "mozak.local/v3", scopes: [] }));
    return runs(prefix, "mozak-mcp", ["--config", inventory], `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } })}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function onPath(name: string, env: NodeJS.ProcessEnv): string | null {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, name);
    try { if (statSync(p).isFile()) return p; } catch { /* next */ }
  }
  return null;
}

/** A PATH command is this installation's when it is, links to, or is a wrapper that execs, PREFIX/bin/<name>. */
function pointsAt(command: string, prefix: string, name: string, home: string): boolean {
  const target = join(prefix, "bin", name);
  if (sameTarget(command, target)) return true;
  try {
    const text = readFileSync(command, "utf8");
    if (text.length > 4096) return false;
    return text.includes(target) || text.replaceAll("$HOME", home).replaceAll("${HOME}", home).includes(target);
  } catch {
    return false;
  }
}

function wrapper(prefix: string, name: string): string {
  return `#!/usr/bin/env bash\nexec node ${JSON.stringify(join(prefix, "bin", name))} "$@"\n`;
}

interface McpEntry { file: string; command: string; args: string[] }

function mcpEntries(home: string): McpEntry[] {
  const out: McpEntry[] = [];
  for (const [rel, key] of [[".claude.json", "mcpServers"], [".jcode/mcp.json", "servers"]] as const) {
    const file = join(home, rel);
    if (!existsSync(file)) continue;
    try {
      const j = JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, { command?: unknown; args?: unknown }>>;
      const s = j[key]?.mozak;
      if (s && typeof s.command === "string") out.push({ file, command: s.command, args: Array.isArray(s.args) ? s.args.filter((a): a is string => typeof a === "string") : [] });
      else out.push({ file, command: "", args: [] });
    } catch {
      out.push({ file, command: "", args: [] });
    }
  }
  return out;
}

function configArg(args: string[]): string | null {
  const i = args.indexOf("--config");
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}

/** Vault folders (whose config folder holds plugins/mozak) at or under a folder, a few levels deep. */
function vaultsUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    const plugin = vaultPluginDir(dir);
    if (plugin && existsSync(join(plugin, "main.js"))) out.push(dir);
    if (depth >= MAX_VAULT_DEPTH) return;
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (n.startsWith(".") || n === "node_modules") continue;
      const p = join(dir, n);
      try { if (lstatSync(p).isDirectory()) walk(p, depth + 1); } catch { /* skip */ }
    }
  };
  walk(root, 0);
  return out.sort();
}

/**
 * Doctor for an npm install: npm owns the files and the `mozak` / `mozak-mcp` commands, so there is no manifest,
 * no wrapper and no source checkout to check. npm runs no install scripts, so the skill ships as a template and
 * `--fix` renders it once per version into ~/.local/share/mozak-npm/<version>/skills/mozak (absolute CLI path
 * filled in, same as the portable installer), then links each agent's skills folder to that copy.
 */
function renderNpmSkill(npmRoot: string, version: string, home: string): string {
  const target = join(home, ".local", "share", "mozak-npm", version, "skills", "mozak");
  const template = join(npmRoot, "skills-template", "mozak");
  const cli = join(npmRoot, "dist", "cli.js");
  const quoted = "'" + cli.replaceAll("'", "'\"'\"'") + "'";
  const walk = (rel: string) => {
    for (const name of readdirSync(join(template, rel))) {
      const r = rel ? join(rel, name) : name;
      if (statSync(join(template, r)).isDirectory()) { walk(r); continue; }
      const text = readFileSync(join(template, r), "utf8").replaceAll("{{MOZAK_CLI}}", quoted).replaceAll("{{MOZAK_SKILL}}", target);
      if (/\{\{[A-Z_]+\}\}/u.test(text)) throw new Error(`skill template ${r} has unresolved placeholders`);
      mkdirSync(dirname(join(target, r)), { recursive: true });
      writeFileSync(join(target, r), text);
    }
  };
  walk("");
  return target;
}

function doctorNpm(
  args: DoctorArgs, npm: { root: string; version: string }, home: string, env: NodeJS.ProcessEnv,
  checks: Check[], add: (c: Check) => Check,
): { exitCode: number; data: Record<string, unknown> } {
  add({ id: "installation", state: "ok", message: `npm package at ${npm.root} is mozak ${npm.version}` });
  for (const name of ["mozak", "mozak-mcp"]) {
    const found = onPath(name, env);
    add(found
      ? { id: `path-${name}`, state: "ok", message: `${name} on PATH is ${found}` }
      : { id: `path-${name}`, state: "fail", message: `${name} is not on PATH`, fix: "Add npm's global bin folder to PATH (npm prefix -g, then its bin folder), or reinstall: npm install -g mozak" });
  }
  const skillTarget = join(home, ".local", "share", "mozak-npm", npm.version, "skills", "mozak");
  if (args.fix && !existsSync(join(skillTarget, "SKILL.md"))) renderNpmSkill(npm.root, npm.version, home);
  for (const rel of SKILL_DIRS) {
    const dir = join(home, rel);
    if (!existsSync(dir)) continue;
    const link = join(dir, "mozak");
    const id = `skill-${rel.split("/")[0].slice(1)}`;
    const linkFix = "mozak doctor --fix";
    if (isLink(link) && sameTarget(link, skillTarget)) { add({ id, state: "ok", message: `${link} links to the skill for this npm package` }); continue; }
    const c = add({ id, state: "warn", message: isLink(link) ? `${link} links to ${readlinkSync(link)}, not this npm package's skill` : existsSync(link) ? `${link} is an old copy, not a link to this npm package's skill` : `${dir} has no mozak skill`, fix: linkFix });
    if (args.fix && existsSync(skillTarget)) {
      let note = "";
      if (isLink(link)) renameSync(link, freeName(`${link}.previous-link-${stamp()}`));
      else if (existsSync(link)) { const backup = freeName(`${link}.backup-${stamp()}`); renameSync(link, backup); note = ` (old copy moved to ${backup})`; }
      symlinkSync(skillTarget, link);
      c.fixed = `linked ${link} -> ${skillTarget}${note}`;
    }
  }
  if (args.config) {
    try {
      const inv = loadInventory(resolve(args.config));
      const out = executeOperation(inv, "scopes", {}, "agent");
      const rows = (out.data.scopes ?? []) as Array<{ id: string; status?: string; error?: unknown }>;
      const failed = rows.filter((r) => r.status === "failed" || r.error);
      add(failed.length === 0
        ? { id: "inventory", state: "ok", message: `${args.config}: ${rows.length} scope(s), all readable` }
        : { id: "inventory", state: "fail", message: `${args.config}: ${failed.length} scope(s) do not read: ${failed.map((r) => r.id).join(", ")}`, fix: `mozak check --config ${args.config} --scope ${failed[0].id}` });
    } catch (err) {
      add({ id: "inventory", state: "fail", message: `${args.config} does not load: ${err instanceof Error ? err.message : String(err)}`, fix: "Fix the JSON, or see docs/installation.md (Inventory)" });
    }
  } else {
    add({ id: "inventory", state: "warn", message: "no inventory checked (pass --config FILE)", fix: "mozak doctor --config /path/to/mozak-inventory.json" });
  }
  const update = cachedUpdateNotice(npm.version, { env });
  if (update) add({ id: "update", state: "warn", message: `mozak ${update.latest} is available (installed ${update.installed})`, fix: update.command });
  const open = checks.filter((c) => !c.fixed);
  const fails = open.filter((c) => c.state === "fail").length;
  const warns = open.filter((c) => c.state === "warn").length;
  return {
    exitCode: fails > 0 ? 3 : 0,
    data: { status: fails > 0 ? "fail" : warns > 0 ? "warn" : "ok", install: "npm", prefix: npm.root, version: npm.version, fixed: checks.filter((c) => c.fixed).length, checks },
  };
}

export function doctor(args: DoctorArgs): { exitCode: number; data: Record<string, unknown> } {
  const env = args.env ?? process.env;
  const home = args.home ?? env.HOME ?? "";
  const checks: Check[] = [];
  const add = (c: Check) => { checks.push(c); return c; };

  // 1. Node.
  add(nodeInRange(process.versions.node)
    ? { id: "node", state: "ok", message: `Node ${process.versions.node}` }
    : { id: "node", state: "fail", message: `Node ${process.versions.node} is older than 24.11.0`, fix: "Install Node 24.11 or newer (https://nodejs.org)" });

  // 2. The installation.
  const npm = args.prefix ? null : npmInstall();
  if (npm) return doctorNpm(args, npm, home, env, checks, add);
  const here = args.prefix ? null : installedVersion();
  const prefix = args.prefix ? resolve(args.prefix) : here?.prefix ?? join(home, ".local", "share", "mozak");
  let version: string | null = null;
  let source: string | null = null;
  try {
    const m = JSON.parse(readFileSync(join(prefix, "installation.json"), "utf8")) as { version?: string; source?: string };
    version = m.version ?? null;
    source = typeof m.source === "string" ? m.source : null;
  } catch { /* reported below */ }
  const reinstall = `git clone https://github.com/pitfa19/mozak && cd mozak && npm ci && npm run build && node scripts/install.mjs --prefix ${prefix} --json`;
  if (!version) {
    add({ id: "installation", state: "fail", message: `no mozak installation at ${prefix}`, fix: reinstall });
  } else {
    const bad = verifyInstallation(prefix);
    const cliOk = !bad && runs(prefix, "mozak", ["--help"]);
    const mcpOk = !bad && mcpAnswers(prefix);
    if (bad || !cliOk) add({ id: "installation", state: "fail", message: `${prefix} (${version}): ${bad ?? "bin/mozak does not run"}`, fix: `Move ${prefix} to the Trash, then: ${reinstall}` });
    else if (!mcpOk) add({ id: "installation", state: "fail", message: `${prefix} (${version}): bin/mozak-mcp does not answer an MCP handshake`, fix: `Move ${prefix} to the Trash, then: ${reinstall}` });
    else add({ id: "installation", state: "ok", message: `${prefix} is mozak ${version}; mozak and mozak-mcp run` });
    if (!source) add({ id: "source", state: "warn", message: "installation.json does not record its source checkout, so mozak upgrade needs --source PATH", fix: `mozak upgrade --source /path/to/mozak` });
    else if (!existsSync(join(source, ".git"))) add({ id: "source", state: "warn", message: `source checkout ${source} is gone, so mozak upgrade needs --source PATH`, fix: "git clone https://github.com/pitfa19/mozak, then mozak upgrade --source <that folder>" });
    else add({ id: "source", state: "ok", message: `upgrades build from ${source}` });
  }

  // 3. PATH commands, with the ~/.local/bin wrappers as the safe fix.
  const binDir = join(home, ".local", "bin");
  for (const name of ["mozak", "mozak-mcp"]) {
    const found = onPath(name, env);
    const wrapperPath = join(binDir, name);
    if (found && pointsAt(found, prefix, name, home)) { add({ id: `path-${name}`, state: "ok", message: `${name} on PATH is ${found}` }); continue; }
    const c = add({
      id: `path-${name}`,
      state: found ? "warn" : "fail",
      message: found ? `${name} on PATH is ${found}, which is not this installation (${prefix})` : `${name} is not on PATH`,
      fix: found ? `Remove ${found} or put ${binDir} first on PATH` : `Create ${wrapperPath} (mozak doctor --fix) and add ${binDir} to PATH`,
    });
    if (args.fix && version && !existsSync(wrapperPath) && !isLink(wrapperPath)) {
      mkdirSync(binDir, { recursive: true });
      writeFileSync(wrapperPath, wrapper(prefix, name), { mode: 0o755, flag: "wx" });
      chmodSync(wrapperPath, 0o755);
      c.fixed = `created ${wrapperPath}${(env.PATH ?? "").split(delimiter).includes(binDir) ? "" : `; add ${binDir} to PATH`}`;
    }
  }

  // 4. Agent skill links.
  const skillTarget = join(prefix, "skills", "mozak");
  for (const rel of SKILL_DIRS) {
    const dir = join(home, rel);
    if (!existsSync(dir)) continue;
    const link = join(dir, "mozak");
    const id = `skill-${rel.split("/")[0].slice(1)}`;
    const linkFix = `ln -sfn ${skillTarget} ${link}`;
    let c: Check;
    if (isLink(link) && sameTarget(link, skillTarget)) { add({ id, state: "ok", message: `${link} links to this installation` }); continue; }
    if (isLink(link)) c = add({ id, state: "warn", message: `${link} links to ${readlinkSync(link)}, not this installation`, fix: linkFix });
    else if (existsSync(link)) c = add({ id, state: "warn", message: `${link} is an old copy, not a link to this installation`, fix: `mv ${link} ${link}.backup-<date> && ${linkFix}` });
    else c = add({ id, state: "warn", message: `${dir} has no mozak skill`, fix: linkFix });
    if (args.fix && version && existsSync(skillTarget)) {
      let note = "";
      if (isLink(link)) renameSync(link, freeName(`${link}.previous-link-${stamp()}`));
      else if (existsSync(link)) { const backup = freeName(`${link}.backup-${stamp()}`); renameSync(link, backup); note = ` (old copy moved to ${backup})`; }
      symlinkSync(skillTarget, link);
      c.fixed = `linked ${link} -> ${skillTarget}${note}`;
    }
  }

  // 5. MCP config. Reported with the exact change, never edited.
  const mcp = mcpEntries(home);
  const mcpWrapper = join(binDir, "mozak-mcp");
  let mcpInventory: string | null = null;
  for (const e of mcp) {
    const id = `mcp-${e.file.endsWith(".claude.json") ? "claude" : "jcode"}`;
    const inv = configArg(e.args);
    if (!e.command) { add({ id, state: "warn", message: `${e.file} has no mozak MCP server`, fix: `Add a "mozak" server: command ${mcpWrapper}, args ["--config", "<inventory.json>"]` }); continue; }
    const commandOk = pointsAt(e.command, prefix, "mozak-mcp", home) || (existsSync(e.command) && pointsAt(realpathSync(e.command), prefix, "mozak-mcp", home));
    // The inventory it names is checked below whatever is wrong with the command.
    if (inv && existsSync(inv)) mcpInventory ??= inv;
    // A setting that names the standard wrapper is right even when the wrapper is still missing: the PATH check
    // above reports (and with --fix creates) the wrapper, so this does not blame the MCP file for it.
    const namesWrapper = e.command === mcpWrapper;
    if (!commandOk && !namesWrapper) { add({ id, state: "fail", message: `${e.file}: the mozak server runs ${e.command}, not this installation`, fix: `In ${e.file}, set the mozak server's command to ${mcpWrapper}` }); continue; }
    if (!commandOk && namesWrapper && !existsSync(mcpWrapper)) { add({ id, state: "fail", message: `${e.file}: the mozak server runs ${mcpWrapper}, which does not exist`, fix: "mozak doctor --fix (creates the wrapper)" }); continue; }
    if (!commandOk) { add({ id, state: "fail", message: `${e.file}: ${mcpWrapper} does not run this installation`, fix: `Move ${mcpWrapper} to the Trash, then mozak doctor --fix` }); continue; }
    if (!inv || !existsSync(inv)) { add({ id, state: "fail", message: `${e.file}: the mozak server's --config ${inv ?? "(missing)"} does not exist`, fix: `In ${e.file}, set the mozak server's args to ["--config", "<your inventory.json>"]` }); continue; }
    mcpInventory ??= inv;
    add({ id, state: "ok", message: `${e.file} runs this installation with ${inv}` });
  }

  // 6. Inventory: every scope reads.
  const inventoryPath = args.config ? resolve(args.config) : mcpInventory;
  let inventoryDir: string | null = null;
  if (!inventoryPath) {
    add({ id: "inventory", state: "warn", message: "no inventory found (pass --config FILE, or connect an agent first)", fix: "mozak doctor --config /path/to/mozak-inventory.json" });
  } else {
    try {
      const inv = loadInventory(inventoryPath);
      inventoryDir = dirname(inventoryPath);
      const out = executeOperation(inv, "scopes", {}, "agent");
      const cov = out.data.coverage as { selected: number; complete: boolean; scopes?: Array<{ id: string; status?: string; code?: string }> } | undefined;
      const rows = (out.data.scopes ?? []) as Array<{ id: string; status?: string; code?: string; error?: { code?: string } }>;
      const failed = rows.filter((r) => r.status === "failed" || r.error);
      const codeOf = (r: (typeof rows)[number]) => r.code ?? r.error?.code;
      if (cov?.complete && failed.length === 0) add({ id: "inventory", state: "ok", message: `${inventoryPath}: ${rows.length} scope(s), all readable` });
      else {
        const uninit = failed.filter((r) => codeOf(r) === "scope-uninitialized");
        add({
          id: "inventory",
          state: "fail",
          message: `${inventoryPath}: ${failed.length || "some"} scope(s) do not read: ${failed.map((r) => `${r.id}${codeOf(r) ? ` (${codeOf(r)})` : ""}`).join(", ")}`,
          fix: uninit.length === failed.length && uninit.length > 0
            ? `These folders have no mozak.json. If your notes repo should have them, pull it; otherwise start each with mozak scope init (see the skill's references/bootstrap.md).`
            : `mozak check --config ${inventoryPath} --scope ${failed[0]?.id ?? "<id>"}`,
        });
      }
    } catch (err) {
      add({ id: "inventory", state: "fail", message: `${inventoryPath} does not load: ${err instanceof Error ? err.message : String(err)}`, fix: "Fix the JSON, or see docs/installation.md (Inventory)" });
    }
  }

  // 7. Obsidian plugin copies under the inventory's folder: same version as the installation, and when the source
  //    checkout has this release's build, the same bytes.
  if (inventoryDir && version) {
    const built = source ? join(source, "packages", "obsidian", "dist", "plugin", "main.js") : null;
    const builtVersion = built ? (() => { try { return (JSON.parse(readFileSync(join(dirname(built), "manifest.json"), "utf8")) as { version?: string }).version ?? null; } catch { return null; } })() : null;
    const buildUsable = built !== null && builtVersion === version && existsSync(built);
    for (const vault of vaultsUnder(inventoryDir)) {
      const target = vaultPluginDir(vault);
      if (!target) continue;
      const copyVersion = (() => { try { return (JSON.parse(readFileSync(join(target, "manifest.json"), "utf8")) as { version?: string }).version ?? null; } catch { return null; } })();
      const current = copyVersion === version && (!buildUsable || sha256(join(target, "main.js")) === sha256(built));
      const installCmd = source ? `node ${join(source, "scripts", "install-obsidian-plugin.mjs")} ${vault}` : `node <mozak checkout>/scripts/install-obsidian-plugin.mjs ${vault}`;
      if (current) { add({ id: `plugin:${vault}`, state: "ok", message: `${vault}: plugin ${copyVersion} matches the installation` }); continue; }
      const c = add({ id: `plugin:${vault}`, state: "warn", message: `${vault}: plugin ${copyVersion ?? "unknown"} is not this release's build (${version})`, fix: installCmd });
      if (args.fix && buildUsable) {
        const r = spawnSync(process.execPath, [join(source!, "scripts", "install-obsidian-plugin.mjs"), vault], { encoding: "utf8", timeout: 60_000 });
        if (r.status === 0) c.fixed = `reinstalled the plugin into ${vault}; reload Obsidian`;
      } else if (args.fix && source) {
        c.fix = `cd ${source} && git checkout v${version} && npm run build && ${installCmd} && git checkout -`;
      }
    }
  }

  // 8. Update notice, from the cache only.
  const update = version ? cachedUpdateNotice(version, { env }) : null;
  if (update) add({ id: "update", state: "warn", message: `mozak ${update.latest} is available (installed ${update.installed})`, fix: update.command });

  // A check that was fixed counts as ok.
  const open = checks.filter((c) => !c.fixed);
  const fails = open.filter((c) => c.state === "fail").length;
  const warns = open.filter((c) => c.state === "warn").length;
  return {
    exitCode: fails > 0 ? 3 : 0,
    data: { status: fails > 0 ? "fail" : warns > 0 ? "warn" : "ok", prefix, version, fixed: checks.filter((c) => c.fixed).length, checks },
  };
}

export function renderDoctor(data: Record<string, unknown>): string {
  const checks = data.checks as Check[];
  const mark = (c: Check) => (c.fixed ? "fixed" : c.state);
  const lines = checks.map((c) => {
    let s = `${mark(c).padEnd(5)}  ${c.message}`;
    if (c.fixed) s += `\n       ${c.fixed}`;
    else if (c.fix && c.state !== "ok") s += `\n       fix: ${c.fix}`;
    return s;
  });
  const open = checks.filter((c) => !c.fixed && c.state !== "ok");
  const safe = open.some((c) => /^(path-|skill-|plugin:)/.test(c.id));
  lines.push("", open.length === 0 ? "All checks pass." : `${open.length} to look at.${safe ? " mozak doctor --fix applies the safe fixes (links, wrappers, plugin copies)." : ""}`);
  return `${lines.join("\n")}\n`;
}
