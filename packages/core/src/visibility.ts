// Visibility guard for repo-mode remote scopes. A public repo that holds plan files publishes them, so writes are
// refused and a warning is shown. The check uses the unauthenticated GitHub API, never credentials, and never blocks
// reads. Any failure is "unknown", which never blocks anything. Tests replace the checker; no test touches the network.

import { execFileSync } from "node:child_process";
import { readRemoteMeta, writeRemoteMeta, type Visibility } from "./remote-meta.ts";
import type { ScopeEntry } from "./scope-index.ts";

export const VISIBILITY_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_S = 5;

export type VisibilityChecker = (spec: string) => Visibility;

/** "owner/repo" for a GitHub remote spec or URL, null for anything else. */
export function githubSlug(spec: string): string | null {
  const s = spec.trim();
  let m = /^github:([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?$/.exec(s);
  if (m) return `${m[1]}/${m[2]}`.toLowerCase();
  m = /^(?:https:\/\/|ssh:\/\/git@|git@)github\.com[/:]([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?\/?$/.exec(s);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

/** Default checker: one unauthenticated request with a hard timeout. Uses curl so core stays synchronous. */
export const githubVisibility: VisibilityChecker = (spec) => {
  const slug = githubSlug(spec);
  if (!slug) return "unknown";
  try {
    const out = execFileSync("curl", ["-sS", "--max-time", String(TIMEOUT_S), "-H", "Accept: application/vnd.github+json", "-w", "\n%{http_code}", `https://api.github.com/repos/${slug}`], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: (TIMEOUT_S + 2) * 1000, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    const nl = out.lastIndexOf("\n");
    const code = out.slice(nl + 1).trim();
    if (code === "404") return "private-or-missing";
    if (code !== "200") return "unknown";
    const body = JSON.parse(out.slice(0, nl)) as { private?: unknown };
    return body.private === false ? "public" : body.private === true ? "private-or-missing" : "unknown";
  } catch {
    return "unknown";
  }
};

let checker: VisibilityChecker = githubVisibility;

/** Test seam: replace the checker and get back a restore function. */
export function setVisibilityChecker(next: VisibilityChecker): () => void {
  const prior = checker;
  checker = next;
  return () => { checker = prior; };
}

/**
 * Visibility of a remote scope's repo, cached in its remote meta for 24 hours. Local scopes report "unknown".
 * Only repo-mode scopes are ever blocked on it; vault-mode scopes use it as a sidebar label. A fresh "unknown"
 * result is cached for a shorter hour, so a transient failure retries.
 */
export function scopeVisibility(entry: ScopeEntry, opts: { force?: boolean; now?: Date } = {}): Visibility {
  const r = entry.remote;
  if (!r) return "unknown";
  const now = opts.now ?? new Date();
  const meta = readRemoteMeta(r.baseDir, entry.id);
  const age = meta.visibilityCheckedAt ? now.getTime() - Date.parse(meta.visibilityCheckedAt) : Infinity;
  const ttl = meta.visibility === "unknown" ? VISIBILITY_TTL_MS / 24 : VISIBILITY_TTL_MS;
  if (!opts.force && meta.visibility && age < ttl) return meta.visibility;
  const v = checker(r.spec);
  try {
    writeRemoteMeta(r.baseDir, entry.id, { ...meta, visibility: v, visibilityCheckedAt: now.toISOString() });
  } catch {
    /* an unwritable cache only means the next call checks again */
  }
  return v;
}

/** Last cached answer without any network call. Null when never checked or not a remote scope. */
export function cachedVisibility(entry: ScopeEntry): Visibility | null {
  const r = entry.remote;
  if (!r) return null;
  return readRemoteMeta(r.baseDir, entry.id).visibility ?? null;
}

export function publicRepoPlansMessage(entry: ScopeEntry): string {
  return `${entry.remote?.spec ?? entry.id} is public, so plans committed to it are published. Move them to a vault folder by adding "plans": "<folder>" to the "${entry.id}" inventory entry, then copy MOZAK.json there.`;
}
