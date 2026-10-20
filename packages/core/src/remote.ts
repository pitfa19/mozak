// Remote scopes. A remote scope is a git repo cached next to the inventory file. Only README.md, the plan files
// (mozak.json, mozak.md, or their pre-0.4 MOZAK.* names) and AGENTS.md are checked out (sparse, blobless, depth 1). Everything shells out to git with
// execFile (no shell), a hard timeout and no terminal prompts. Nothing outside inventoried scopes is touched.

import { execFileSync } from "node:child_process";
import { SCOPE_FILE_NAMES, scopeFile, scopeFileName } from "./scope-files.ts";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DomainError } from "./errors.ts";
import { FRESH_MS, readRemoteMeta, writeRemoteMeta, type RemoteStatus } from "./remote-meta.ts";
import type { ScopeEntry, ScopeInventory } from "./scope-index.ts";

export const SPARSE_FILES = ["README.md", ...SCOPE_FILE_NAMES, "AGENTS.md"] as const;
const CLONE_TIMEOUT_MS = 120_000;
const GIT_TIMEOUT_MS = 60_000;

function git(args: string[], cwd: string | undefined, timeout = GIT_TIMEOUT_MS): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", LC_ALL: "C" },
    });
  } catch (err) {
    const e = err as { stderr?: Buffer | string; killed?: boolean; code?: string; message?: string };
    const stderr = String(e.stderr ?? "").trim().split("\n").slice(-3).join(" ");
    const why = e.killed || e.code === "ETIMEDOUT" ? `timed out after ${timeout / 1000}s` : stderr || e.message || "git failed";
    throw new GitFailure(`git ${args[0]}: ${why}`);
  }
}

class GitFailure extends Error {}

function remoteOf(entry: ScopeEntry) {
  if (!entry.remote) throw new DomainError("scope-not-remote", `scope "${entry.id}" is not a remote scope`);
  return entry.remote;
}

function isRepo(dir: string): boolean {
  try {
    return lstatSync(join(dir, ".git")).isDirectory();
  } catch {
    return false;
  }
}

function sparsePatterns(): string[] {
  return SPARSE_FILES.map((name) => `/${name}`);
}

function cloneSparse(entry: ScopeEntry): void {
  const r = remoteOf(entry);
  mkdirSync(dirname(r.cacheRoot), { recursive: true });
  const tmp = `${r.cacheRoot}.tmp-${randomUUID()}`;
  try {
    git(["clone", "--filter=blob:none", "--no-checkout", "--depth", "1", "--sparse", "--branch", r.ref, "--", r.url, tmp], undefined, CLONE_TIMEOUT_MS);
    git(["sparse-checkout", "set", "--no-cone", "--", ...sparsePatterns()], tmp);
    git(["checkout", "--quiet", r.ref], tmp, CLONE_TIMEOUT_MS);
    if (existsSync(r.cacheRoot)) rmSync(r.cacheRoot, { recursive: true, force: true });
    renameSync(tmp, r.cacheRoot);
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  }
}

function pendingFiles(dir: string): boolean {
  return git(["status", "--porcelain", "--", ...SCOPE_FILE_NAMES], dir).trim() !== "";
}

function aheadCount(dir: string, ref: string): number {
  try {
    return Number(git(["rev-list", "--count", `refs/remotes/origin/${ref}..HEAD`], dir).trim()) || 0;
  } catch {
    return 0;
  }
}

function identityEnvFix(dir: string): string[] {
  // Commit with the user's git identity. Fall back to a neutral one only when none is configured.
  let email = "";
  try { email = git(["config", "user.email"], dir).trim(); } catch { /* unset */ }
  return email ? [] : ["-c", "user.name=mozak", "-c", "user.email=mozak@localhost"];
}

function currentBranch(dir: string): string {
  return git(["rev-parse", "--abbrev-ref", "HEAD"], dir).trim();
}

/** Commit only the two plan files, then push. Returns whether a commit was made. */
export function commitAndPush(entry: ScopeEntry, message: string): { committed: boolean; pushed: boolean } {
  const r = remoteOf(entry);
  const dir = entry.root;
  if (currentBranch(dir) !== r.ref) {
    throw new GitFailure(`checked out branch is "${currentBranch(dir)}", expected "${r.ref}"`);
  }
  let committed = false;
  if (pendingFiles(dir)) {
    const present = [scopeFileName(dir, "graph"), scopeFileName(dir, "bridge")].filter((n) => existsSync(join(dir, n)));
    git(["add", "--", ...present], dir);
    git([...identityEnvFix(dir), "commit", "--no-verify", "--quiet", "-m", message, "--", ...present], dir);
    committed = true;
  }
  let pushed = false;
  if (aheadCount(dir, r.ref) > 0) {
    git(["push", "--quiet", "origin", `HEAD:refs/heads/${r.ref}`], dir, CLONE_TIMEOUT_MS);
    pushed = true;
  }
  return { committed, pushed };
}

function refresh(entry: ScopeEntry): void {
  const r = remoteOf(entry);
  const full = r.fullClone !== null && r.fullClone === entry.root;
  const dir = entry.root;
  if (!isRepo(dir)) {
    if (full) throw new GitFailure("full clone is missing");
    cloneSparse(entry);
    return;
  }
  if (currentBranch(dir) !== r.ref) throw new GitFailure(`checked out branch is "${currentBranch(dir)}", expected "${r.ref}"`);
  if (!full) {
    // The sparse cache is a mirror. Recover interrupted writes and push unpushed commits before replacing it.
    if (pendingFiles(dir)) commitAndPush(entry, "mozak: recover uncommitted scope state");
    else if (aheadCount(dir, r.ref) > 0) commitAndPush(entry, "mozak: push pending scope state");
    git(["fetch", "--quiet", "--depth", "1", "origin", r.ref], dir, CLONE_TIMEOUT_MS);
    const head = git(["rev-parse", "HEAD"], dir).trim();
    const fetched = git(["rev-parse", "FETCH_HEAD"], dir).trim();
    if (head !== fetched) git(["reset", "--hard", "--quiet", "FETCH_HEAD"], dir);
    return;
  }
  git(["fetch", "--quiet", "origin", r.ref], dir, CLONE_TIMEOUT_MS);
  git(["merge", "--ff-only", "--quiet", "FETCH_HEAD"], dir);
}

export function statusOf(entry: ScopeEntry, stale: boolean, error?: string): RemoteStatus {
  const r = remoteOf(entry);
  if (r.plansMode === "vault") return vaultStatus(entry);
  const meta = readRemoteMeta(r.baseDir, entry.id);
  return {
    scope: entry.id,
    remote: r.spec,
    ref: r.ref,
    stale,
    lastFetchAt: meta.lastFetchAt,
    ...(error ? { error } : {}),
    source: r.fullClone !== null && r.fullClone === entry.root ? "full-clone" : "sparse-cache",
  };
}

/** Status row for a vault-plans scope. Plans are local, so nothing is fetched and nothing is ever stale. */
export function vaultStatus(entry: ScopeEntry): RemoteStatus {
  const r = remoteOf(entry);
  return { scope: entry.id, remote: r.spec, ref: r.ref, stale: false, lastFetchAt: null, source: "vault" };
}

/**
 * Refresh one remote scope when forced or when the last successful fetch is older than ten minutes.
 * A fetch failure never throws: the cached copy is used and reported stale.
 * Vault-plans scopes never run git: their plans are local and the repo is linked for display only.
 */
export function syncRemote(entry: ScopeEntry, opts: { force?: boolean; now?: Date } = {}): RemoteStatus {
  const r = remoteOf(entry);
  if (r.plansMode === "vault") return vaultStatus(entry);
  const now = opts.now ?? new Date();
  const meta = readRemoteMeta(r.baseDir, entry.id);
  const have = isRepo(entry.root);
  const age = meta.lastFetchAt ? now.getTime() - Date.parse(meta.lastFetchAt) : Infinity;
  if (!opts.force && have && meta.lastError === null && age < FRESH_MS) return statusOf(entry, false);
  try {
    refresh(entry);
    writeRemoteMeta(r.baseDir, entry.id, { ...meta, lastFetchAt: now.toISOString(), lastError: null, fullClone: meta.fullClone });
    return statusOf(entry, false);
  } catch (err) {
    if (!(err instanceof GitFailure)) throw err;
    writeRemoteMeta(r.baseDir, entry.id, { ...meta, lastError: err.message });
    return statusOf(entry, true, err.message);
  }
}

/** Every remote scope, repo-mode and vault-mode. Use repoEntries for anything that runs git on plan files. */
export function remoteEntries(inv: ScopeInventory): ScopeEntry[] {
  return inv.scopes.filter((s) => s.remote !== undefined);
}

/** Remote scopes whose plan files live in the repo, so reads fetch and writes commit and push. */
export function repoEntries(inv: ScopeInventory): ScopeEntry[] {
  return inv.scopes.filter((s) => s.remote !== undefined && s.remote.plansMode === "repo");
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\.git$/, "").toLowerCase();
}

export interface PullResult { scope: string; destination: string; created: boolean; remote: string; ref: string }

/** Convert a remote scope into a full working clone. Never overwrites a different repo.
 * For a vault-plans scope this only clones the code: plans stay in the vault and nothing is recorded as the scope root. */
export function pullRemote(entry: ScopeEntry, into?: string): PullResult {
  const r = remoteOf(entry);
  const dest = resolve(into ? (into === "~" || into.startsWith("~/") ? join(homedir(), into.slice(1)) : into) : join(homedir(), "Documents", r.repoName));
  const vault = r.plansMode === "vault";
  const meta = readRemoteMeta(r.baseDir, entry.id);
  let created = false;
  if (existsSync(dest)) {
    let origin = "";
    try {
      if (!isRepo(dest)) throw new GitFailure("not a git repository");
      origin = git(["remote", "get-url", "origin"], dest).trim();
    } catch {
      throw new DomainError("pull-destination-exists", `${dest} exists and is not the ${r.spec} repository`, 2);
    }
    if (normalizeUrl(origin) !== normalizeUrl(r.url)) {
      throw new DomainError("pull-destination-exists", `${dest} exists and its origin is ${origin}, not ${r.spec}`, 2);
    }
  } else {
    // Push anything the sparse cache still holds, so the full clone starts from the same history.
    if (!vault && isRepo(r.cacheRoot) && r.fullClone === null) {
      try { if (pendingFiles(r.cacheRoot) || aheadCount(r.cacheRoot, r.ref) > 0) commitAndPush({ ...entry, root: r.cacheRoot }, "mozak: push pending scope state"); } catch (err) {
        if (!(err instanceof GitFailure)) throw err;
        throw new DomainError("pull-unpushed-state", `sparse cache has unpushed mozak state: ${err.message}`, 3);
      }
    }
    try {
      mkdirSync(dirname(dest), { recursive: true });
      git(["clone", "--branch", r.ref, "--", r.url, dest], undefined, CLONE_TIMEOUT_MS * 3);
    } catch (err) {
      if (!(err instanceof GitFailure)) throw err;
      if (existsSync(dest) && basename(dest) !== "") rmSync(dest, { recursive: true, force: true });
      throw new DomainError("pull-failed", err.message, 2);
    }
    created = true;
  }
  if (vault) return { scope: entry.id, destination: dest, created, remote: r.spec, ref: r.ref };
  if (!existsSync(scopeFile(dest, "graph"))) {
    throw new DomainError("scope-uninitialized", `not a scope: no mozak.json at the root of ${dest}`, 2);
  }
  writeRemoteMeta(r.baseDir, entry.id, { lastFetchAt: meta.lastFetchAt, lastError: null, fullClone: dest });
  return { scope: entry.id, destination: dest, created, remote: r.spec, ref: r.ref };
}

/** Warning text when the inventory directory is a git repo that does not ignore .mozak-cache. Null otherwise. */
export function cacheIgnoreWarning(baseDir: string): string | null {
  try {
    if (git(["rev-parse", "--is-inside-work-tree"], baseDir).trim() !== "true") return null;
  } catch {
    return null;
  }
  try {
    git(["check-ignore", "-q", "--no-index", "--", ".mozak-cache/probe"], baseDir);
    return null;
  } catch {
    return `${baseDir} is a git repository that does not ignore .mozak-cache/. Add ".mozak-cache/" to its .gitignore.`;
  }
}
