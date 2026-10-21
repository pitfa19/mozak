// Find the inventoried scope for a git working copy, so commands run inside a clone (even one in Downloads) read
// the right plans without --scope. Matching uses the clone's origin URL against remote scope entries only. Reads git
// config locally; never fetches.

import { execFileSync } from "node:child_process";
import { DomainError } from "./errors.ts";
import type { ScopeEntry, ScopeInventory } from "./scope-index.ts";

/** Comparable repo identity: "host/owner/repo" for https, ssh and github: forms, the path for file:// URLs. */
export function repoKey(url: string): string | null {
  const s = url.trim();
  let m = /^github:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(s);
  if (m) return `github.com/${m[1]}/${m[2]}`.toLowerCase();
  m = /^(?:https?:\/\/|ssh:\/\/)(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(s);
  if (m) return `${m[1]}/${m[2]}`.toLowerCase();
  m = /^[^@\s]+@([^:\s]+):(.+?)(?:\.git)?\/?$/.exec(s);
  if (m) return `${m[1]}/${m[2]}`.toLowerCase();
  m = /^file:\/\/(\/.+?)(?:\.git)?\/?$/.exec(s);
  if (m) return `file:${m[1]}`;
  // `git clone /path/to/repo.git` records the bare path as origin.
  m = /^(\/.+?)(?:\.git)?\/?$/.exec(s);
  if (m) return `file:${m[1]}`;
  return null;
}

function gitOrigin(cwd: string): string | null {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
    return execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim() || null;
  } catch {
    return null;
  }
}

/** The one remote scope whose repo matches the git origin of `cwd`. Throws scope-not-found with a hint otherwise. */
export function scopeForWorkingCopy(inv: ScopeInventory, cwd: string): ScopeEntry {
  const origin = gitOrigin(cwd);
  if (origin === null) throw new DomainError("scope-not-found", `no --scope given and ${cwd} is not a git clone with an origin. Pass --scope ID.`);
  const key = repoKey(origin);
  const matches = key === null ? [] : inv.scopes.filter((s) => s.remote !== undefined && repoKey(s.remote.spec) === key);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new DomainError("scope-ambiguous", `origin ${origin} matches several scopes (${matches.map((m) => m.id).join(", ")}). Pass --scope ID.`);
  throw new DomainError("scope-not-found", `no scope in the inventory links ${origin}. Pass --scope ID, or add a remote entry for this repo.`);
}
