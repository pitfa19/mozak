// S2 `check --history N`: find hand edits of mozak.json in git history. Every mozak write sets a new
// storage.revision and records it in a receipt, so a commit that changed mozak.json while keeping the revision,
// or that introduced a revision no receipt names, was made by hand. Reads local git objects only, no network.

import { execFileSync } from "node:child_process";
import { scopeFileName } from "./scope-files.ts";

export const MAX_HISTORY = 500;

export interface HistoryFinding { code: "hand-edit" | "hand-edit-revision" | "history-invalid-json"; message: string; commit: string; date: string; removedPlans?: string[]; addedPlans?: string[] }
export interface HistoryReport { available: boolean; scanned: number; findings: HistoryFinding[]; reason?: string }

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 20_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" } });
  } catch { return null; }
}

interface Parsed { revision: string | null; planIds: string[]; receiptRevisions: Set<string> }
function parse(bytes: string): Parsed | null {
  try {
    const raw = JSON.parse(bytes) as { storage?: { revision?: unknown }; plans?: { id?: unknown }[]; receipts?: Record<string, { storageRevision?: unknown }> };
    const revision = typeof raw.storage?.revision === "string" ? raw.storage.revision : null;
    const planIds = Array.isArray(raw.plans) ? raw.plans.map((p) => (typeof p?.id === "string" ? p.id : "")).filter(Boolean) : [];
    const receiptRevisions = new Set(Object.values(raw.receipts ?? {}).map((r) => r?.storageRevision).filter((v): v is string => typeof v === "string"));
    return { revision, planIds, receiptRevisions };
  } catch { return null; }
}

/** Walk the last `limit` commits that touched this scope's mozak.json, newest first. */
export function handEditHistory(root: string, limit: number): HistoryReport {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY) throw new RangeError(`history must be an integer from 1 to ${MAX_HISTORY}`);
  if (git(root, ["rev-parse", "--is-inside-work-tree"])?.trim() !== "true") return { available: false, scanned: 0, findings: [], reason: "the scope folder is not in a git repository" };
  const name = scopeFileName(root, "graph");
  const log = git(root, ["log", "-n", String(limit), "--format=%H %cI", "--", name]);
  if (log === null) return { available: false, scanned: 0, findings: [], reason: "git log failed" };
  const commits = log.split("\n").filter(Boolean).map((l) => { const [sha, date] = l.split(" "); return { sha: sha!, date: date ?? "" }; });
  const findings: HistoryFinding[] = [];
  for (const c of commits) {
    const short = c.sha.slice(0, 10);
    const after = git(root, ["show", `${c.sha}:./${name}`]);
    if (after === null) continue; // deleted in this commit
    const next = parse(after);
    if (!next) { findings.push({ code: "history-invalid-json", message: `commit ${short} left ${name} as invalid JSON`, commit: c.sha, date: c.date }); continue; }
    const before = git(root, ["show", `${c.sha}^:./${name}`]);
    const prev = before === null ? null : parse(before);
    if (before !== null && prev && before !== after && prev.revision !== null && prev.revision === next.revision) {
      const removedPlans = prev.planIds.filter((id) => !next.planIds.includes(id));
      const addedPlans = next.planIds.filter((id) => !prev.planIds.includes(id));
      const what = [removedPlans.length ? `removed plans ${removedPlans.join(", ")}` : "", addedPlans.length ? `added plans ${addedPlans.join(", ")}` : ""].filter(Boolean).join("; ");
      findings.push({ code: "hand-edit", message: `commit ${short} changed ${name} but kept storage.revision${what ? ` (${what})` : ""}; refs and snapshots may point at removed content`, commit: c.sha, date: c.date, ...(removedPlans.length ? { removedPlans } : {}), ...(addedPlans.length ? { addedPlans } : {}) });
      continue;
    }
    if (next.revision !== null && next.receiptRevisions.size > 0 && !next.receiptRevisions.has(next.revision) && (prev === null || prev.revision !== next.revision)) {
      findings.push({ code: "hand-edit-revision", message: `commit ${short} set storage.revision to a value no receipt records; mozak did not write it`, commit: c.sha, date: c.date });
    }
  }
  return { available: true, scanned: commits.length, findings };
}
