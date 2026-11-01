// Impure loader. Reuses core for parsing and validation: loadInventory, resolveScope, readScope, reviewRows
// (the same functions behind `mozak scopes` and `mozak plans`). Reading never writes. The single write path,
// renderStaleProjections, regenerates mozak.md through core and never touches mozak.json.
import { lstatSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { annotationsEnabled, DomainError, executeOperation, focusChange, loadInventory, readAnnotations, readFocus, readScope, resolveScope, reviewRows, SCOPE_FILE_NAMES } from "@mozak/core";
import { scopesModel, type ScopeLoad, type ScopesModel } from "./model.ts";

const ENTRY_NAMES = ["AGENTS.md", ...SCOPE_FILE_NAMES, "README.md"];

function entryFiles(root: string): string[] {
  let present: Set<string>;
  try { present = new Set(readdirSync(root)); } catch { return []; }
  return ENTRY_NAMES.filter((n) => {
    if (!present.has(n)) return false;
    try { return lstatSync(join(root, n)).isFile(); } catch { return false; }
  });
}

function fail(err: unknown): { code: string; message: string } {
  if (err instanceof DomainError) return { code: err.code, message: err.message };
  return { code: "unexpected-error", message: err instanceof Error ? err.message : String(err) };
}

/** Throws a DomainError when the inventory itself is unreadable or invalid. Per-scope failures become rows. */
export function loadScopesModel(inventoryPath: string): ScopesModel {
  const inv = loadInventory(inventoryPath);
  const focus = readFocus(inventoryPath);
  const loads: ScopeLoad[] = inv.scopes.map((entry) => {
    try {
      const resolved = resolveScope(inv, entry.id);
      const read = readScope(resolved);
      const groups = reviewRows(read.state);
      const reviewNeeded = [...groups.completed, ...groups.open].filter((r) => r.reviewNeeded).map((r) => r.planId);
      return {
        id: entry.id,
        root: resolved.root,
        entryFiles: entryFiles(resolved.root),
        state: read.state,
        counts: { completed: groups.completed.length, open: groups.open.length, awaiting: groups.awaiting.length },
        awaitingRows: groups.awaiting.map((r) => ({ planId: r.planId, rowKind: r.rowKind })),
        reviewNeededPlanIds: reviewNeeded,
        // Owner annotations are display-only here, and read only for scopes that turn them on (off by default).
        // A broken sidecar simply shows no refs; `mozak check` reports it.
        annotations: annotationsEnabled(inv, resolved) ? readAnnotations(resolved.root, entry.id).doc : null,
        focus: focus[entry.id] ?? [],
        ...(entry.repo ? { repo: entry.repo } : {}),
      };
    } catch (err) {
      return { id: entry.id, root: entry.root, entryFiles: entryFiles(entry.root), error: fail(err), ...(entry.repo ? { repo: entry.repo } : {}) };
    }
  });
  return scopesModel(inventoryPath, loads);
}

export { fail as describeError };

/**
 * The star toggle: add or remove one plan in its scope's focus list through core's setFocus (inventory lock, validated
 * atomic write). The plugin never writes plan state. Returns the new list, or the error for a notice.
 */
export function toggleFocus(inventoryPath: string, scope: string, plan: string, focused: boolean): { ok: true; focus: string[] } | { ok: false; code: string; message: string } {
  const out = focusChange(inventoryPath, { scope, plan, action: focused ? "remove" : "add" });
  if (out.exitCode === 0) return { ok: true, focus: out.data.focus as string[] };
  const issue = (out.data.issues as { code: string; message: string }[])[0]!;
  return { ok: false, code: issue.code, message: issue.message };
}

/**
 * Regenerate stale mozak.md projections through core's render operation (the same code as `mozak render --all`).
 * The only write the plugin makes besides the focus star: mozak.md, never mozak.json. Conflicts are reported, not overwritten.
 */
export function renderStaleProjections(inventoryPath: string): { ok: boolean; rendered: number; message: string } {
  const inv = loadInventory(inventoryPath);
  const out = executeOperation(inv, "render", { all: true }, "agent");
  const rows = (out.data.scopes ?? []) as { scope: string; result: string }[];
  const rendered = rows.filter((r) => r.result === "rendered").length;
  const bad = rows.filter((r) => r.result === "conflict" || r.result === "failed");
  const status = typeof out.data.status === "string" ? out.data.status : "unknown";
  if (out.exitCode !== 0 && bad.length === 0) return { ok: false, rendered, message: `Projection refresh failed (${status}).` };
  if (bad.length === 0) return { ok: true, rendered, message: rendered ? `Regenerated ${rendered} mozak.md file${rendered === 1 ? "" : "s"}.` : "mozak.md projections are current." };
  return { ok: false, rendered, message: `mozak.md not regenerated for ${bad.map((r) => `${r.scope} (${r.result === "conflict" ? "unrecognized content preserved for owner review" : "render failed, inspect mozak render output"})`).join(", ")}.` };
}

interface LocalRow { repo: string | null; scopes: string[]; status: string; error?: string }
const LOCAL_OK = new Set(["fast-forwarded", "up-to-date", "ahead"]);

/**
 * The sync button: fast-forward every git repo (vault) that holds a scope, through core (the same code as
 * `mozak sync`). Core takes the scope locks, merges only with --ff-only and never pushes, so a diverged vault is
 * reported, not touched. Returns a one line summary.
 */
export function syncAll(inventoryPath: string): { ok: boolean; message: string } {
  const inv = loadInventory(inventoryPath);
  const out = executeOperation(inv, "sync", {}, "agent");
  return { ok: out.exitCode === 0, message: syncSummary((out.data.local ?? []) as LocalRow[]) };
}

/** One line for a sync notice. Pure, exported for tests. */
export function syncSummary(local: LocalRow[]): string {
  if (local.length === 0) return "Nothing to sync.";
  const name = (r: LocalRow) => (r.repo ? basename(r.repo) : r.scopes.join(", "));
  const pulled = local.filter((r) => r.status === "fast-forwarded").length;
  const ahead = local.filter((r) => r.status === "ahead");
  const okCount = local.filter((r) => LOCAL_OK.has(r.status)).length;
  let s = `${okCount} of ${local.length} vault${local.length === 1 ? "" : "s"} synced`;
  if (pulled) s += ` (${pulled} pulled)`;
  if (ahead.length) s += `, ${ahead.map(name).join(", ")} ha${ahead.length === 1 ? "s" : "ve"} unpushed commits`;
  const bad = local.filter((r) => !LOCAL_OK.has(r.status));
  if (bad.length) s += `. not synced: ${bad.map((r) => `${name(r)}: ${r.status === "not-fast-forward" ? "local and remote diverged, pull by hand" : r.error ?? r.status}`).join("; ")}`;
  return `${s}.`;
}

/** Resolve symlinks for vault-membership checks. Shared with core. */
export { realOrSelf } from "@mozak/core";
