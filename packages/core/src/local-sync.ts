// S2 `mozak sync` for local scopes inside a git repo (a vault). Replaces a bare `git pull --rebase`, which bypasses
// the scope locks. Per repo: fetch outside the locks, take the write locks of every inventoried scope in that repo in
// path order, `git merge --ff-only` the upstream, release. A diverged history is never merged or rebased: the sync
// stops and reports it, so the owner decides. Nothing here pushes.

import { execFileSync } from "node:child_process";
import { DomainError } from "./errors.ts";
import { isWithin, realOrSelf } from "./paths.ts";
import { withScopeLocks, type StoreOptions } from "./scope-store.ts";
import type { ScopeEntry } from "./scope-index.ts";

const FETCH_TIMEOUT_MS = 60_000;

export type LocalSyncStatus = "fast-forwarded" | "up-to-date" | "ahead" | "not-fast-forward" | "fetch-failed" | "busy" | "merge-failed" | "no-upstream" | "detached" | "not-in-git";
export const LOCAL_SYNC_OK: ReadonlySet<LocalSyncStatus> = new Set(["fast-forwarded", "up-to-date", "ahead"]);
export interface LocalSyncRow { repo: string | null; scopes: string[]; locked: string[]; status: LocalSyncStatus; upstream?: string; from?: string; to?: string; error?: string }

class GitError extends Error {}
function git(cwd: string, args: string[], timeout = 20_000): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", LC_ALL: "C" } }).trim();
  } catch (err) {
    const e = err as { stderr?: Buffer | string; killed?: boolean; code?: string; message?: string };
    const stderr = String(e.stderr ?? "").trim().split("\n").slice(-2).join(" ");
    throw new GitError(e.killed || e.code === "ETIMEDOUT" ? `git ${args[0]} timed out` : `git ${args[0]}: ${stderr || e.message || "failed"}`);
  }
}
function tryGit(cwd: string, args: string[]): string | null { try { return git(cwd, args); } catch { return null; } }

/** Scopes whose plan files live in a local folder: local scopes and vault-plans scopes. Repo-mode remotes have their own sync. */
export function localEntries(scopes: ScopeEntry[]): ScopeEntry[] {
  return scopes.filter((s) => !s.remote || s.remote.plansMode === "vault");
}

/**
 * Sync the git repos that hold `targets`. Every inventoried local or vault-plans scope inside such a repo is locked
 * during the merge, not only the targets, because the merge rewrites the whole working tree.
 */
export function syncLocal(targets: ScopeEntry[], all: ScopeEntry[], options: StoreOptions = {}): LocalSyncRow[] {
  const candidates = localEntries(all);
  const repos = new Map<string, ScopeEntry[]>();
  const rows: LocalSyncRow[] = [];
  for (const entry of localEntries(targets)) {
    const top = tryGit(entry.root, ["rev-parse", "--show-toplevel"]);
    if (!top) { rows.push({ repo: null, scopes: [entry.id], locked: [], status: "not-in-git" }); continue; }
    const key = realOrSelf(top);
    repos.set(key, [...(repos.get(key) ?? []), entry]);
  }
  for (const [top, selected] of repos) {
    const scopes = selected.map((e) => e.id).sort();
    const lockRoots = candidates.filter((e) => isWithin(realOrSelf(e.root), top));
    const locked = lockRoots.map((e) => e.id).sort();
    const row = (status: LocalSyncStatus, extra: Partial<LocalSyncRow> = {}): LocalSyncRow => ({ repo: top, scopes, locked, status, ...extra });
    const branch = tryGit(top, ["symbolic-ref", "--short", "-q", "HEAD"]);
    if (!branch) { rows.push(row("detached")); continue; }
    const remote = tryGit(top, ["config", "--get", `branch.${branch}.remote`]);
    const upstream = tryGit(top, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    if (!remote || !upstream) { rows.push(row("no-upstream")); continue; }
    // Fetch outside the locks: it can take seconds and only updates remote-tracking refs.
    try { git(top, ["fetch", "--quiet", "--", remote], FETCH_TIMEOUT_MS); }
    catch (e) { rows.push(row("fetch-failed", { upstream, error: (e as Error).message })); continue; }
    const head = git(top, ["rev-parse", "HEAD"]);
    const up = git(top, ["rev-parse", "@{u}"]);
    if (head === up) { rows.push(row("up-to-date", { upstream, from: head, to: head })); continue; }
    const behind = tryGit(top, ["merge-base", "--is-ancestor", "HEAD", "@{u}"]) !== null;
    if (!behind) {
      const ahead = tryGit(top, ["merge-base", "--is-ancestor", "@{u}", "HEAD"]) !== null;
      rows.push(row(ahead ? "ahead" : "not-fast-forward", { upstream, from: head, to: head, ...(ahead ? {} : { error: "local and upstream history diverged; nothing was merged" }) }));
      continue;
    }
    try {
      const after = withScopeLocks(lockRoots.map((e) => e.root), () => {
        options.onPhase?.("sync-locked");
        // ff-only refuses anything but a fast-forward, and refuses before touching files a local change would lose.
        git(top, ["merge", "--ff-only", "--quiet", up]);
        return git(top, ["rev-parse", "HEAD"]);
      }, options);
      rows.push(row("fast-forwarded", { upstream, from: head, to: after }));
    } catch (e) {
      if (e instanceof DomainError && (e.code === "busy" || e.code === "recovery-required")) rows.push(row("busy", { upstream, from: head, to: head, error: e.message }));
      else if (e instanceof GitError) rows.push(row("merge-failed", { upstream, from: head, to: tryGit(top, ["rev-parse", "HEAD"]) ?? head, error: e.message }));
      else throw e;
    }
  }
  return rows;
}
