// Impure loader. Reuses core for parsing and validation: loadInventory, resolveScope, readScope, reviewRows
// (the same functions behind `mozak scopes` and `mozak plans`). Reading never writes. The single write path,
// renderStaleProjections, regenerates mozak.md through core and never touches mozak.json.
import { lstatSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { DomainError, executeOperation, loadInventory, readAnnotations, readRemoteMeta, readScope, resolveScope, reviewRows, SCOPE_FILE_NAMES } from "@mozak/core";
import { remoteVM, scopesModel, type ScopeLoad, type ScopesModel } from "./model.ts";

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
  const loads: ScopeLoad[] = inv.scopes.map((entry) => {
    // Remote scopes are read from the local cache only. Refreshing the view never touches the network.
    const remote = entry.remote
      ? remoteVM(entry.remote.spec, entry.remote.ref, readRemoteMeta(entry.remote.baseDir, entry.id), new Date(), undefined, entry.remote.plansMode === "vault")
      : undefined;
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
        // Owner annotations are display-only here. A broken sidecar simply shows no refs; `mozak check` reports it.
        annotations: readAnnotations(resolved.root, entry.id).doc,
        ...(remote ? { remote } : {}),
      };
    } catch (err) {
      return { id: entry.id, root: entry.root, entryFiles: entryFiles(entry.root), error: fail(err), ...(remote ? { remote } : {}) };
    }
  });
  return scopesModel(inventoryPath, loads);
}

export { fail as describeError };

/**
 * Regenerate stale mozak.md projections through core's render operation (the same code as `mozak render --all`).
 * The only write the plugin makes: mozak.md of local scopes, never mozak.json. Conflicts are reported, not overwritten.
 */
export function renderStaleProjections(inventoryPath: string): { ok: boolean; rendered: number; message: string } {
  const inv = loadInventory(inventoryPath);
  const out = executeOperation(inv, "render", { all: true }, "agent");
  const rows = (out.data.scopes ?? []) as { scope: string; result: string }[];
  const rendered = rows.filter((r) => r.result === "rendered").length;
  const bad = rows.filter((r) => r.result === "conflict" || r.result === "failed");
  if (out.exitCode !== 0 && bad.length === 0) return { ok: false, rendered, message: `Projection refresh failed (${String(out.data.status ?? "unknown")}).` };
  if (bad.length === 0) return { ok: true, rendered, message: rendered ? `Regenerated ${rendered} mozak.md file${rendered === 1 ? "" : "s"}.` : "Local mozak.md projections are current. Remote scopes are skipped." };
  return { ok: false, rendered, message: `mozak.md not regenerated for ${bad.map((r) => `${r.scope} (${r.result === "conflict" ? "unrecognized content preserved for owner review" : "render failed, inspect mozak render output"})`).join(", ")}.` };
}

/** Force-refresh every remote scope through core (the same code as `mozak sync`). Returns a one line summary. */
export function syncRemoteScopes(inventoryPath: string): { ok: boolean; message: string } {
  const inv = loadInventory(inventoryPath);
  const out = executeOperation(inv, "sync", {}, "agent");
  const remote = (out.data.remote ?? []) as { scope: string; stale: boolean; error?: string }[];
  if (remote.length === 0) return { ok: true, message: "No remote scopes in the inventory." };
  const stale = remote.filter((r) => r.stale);
  if (stale.length === 0) return { ok: true, message: `Synced ${remote.length} remote scope${remote.length === 1 ? "" : "s"}.` };
  return { ok: false, message: `${stale.length} of ${remote.length} could not sync (using cached copy): ${stale.map((r) => `${r.scope}: ${r.error ?? "failed"}`).join("; ")}` };
}

interface LocalRow { repo: string | null; scopes: string[]; status: string; error?: string }
const LOCAL_OK = new Set(["fast-forwarded", "up-to-date", "ahead"]);

/**
 * The sync button: refresh remote scopes and fast-forward every git repo (vault) that holds a local scope, through
 * core (the same code as `mozak sync --local`). Core takes the scope locks, merges only with --ff-only and never pushes,
 * so a diverged vault is reported, not touched. Returns a one line summary.
 */
export function syncAll(inventoryPath: string): { ok: boolean; message: string } {
  const inv = loadInventory(inventoryPath);
  const out = executeOperation(inv, "sync", { local: true }, "agent");
  return { ok: out.exitCode === 0, message: syncSummary((out.data.remote ?? []) as { scope: string; stale: boolean; error?: string }[], (out.data.local ?? []) as LocalRow[]) };
}

/** One line for a sync notice. Pure, exported for tests. */
export function syncSummary(remote: { scope: string; stale: boolean; error?: string }[], local: LocalRow[]): string {
  const parts: string[] = [];
  const name = (r: LocalRow) => (r.repo ? basename(r.repo) : r.scopes.join(", "));
  if (local.length > 0) {
    const pulled = local.filter((r) => r.status === "fast-forwarded").length;
    const ahead = local.filter((r) => r.status === "ahead");
    const okCount = local.filter((r) => LOCAL_OK.has(r.status)).length;
    let s = `${okCount} of ${local.length} vault${local.length === 1 ? "" : "s"} synced`;
    if (pulled) s += ` (${pulled} pulled)`;
    if (ahead.length) s += `, ${ahead.map(name).join(", ")} ha${ahead.length === 1 ? "s" : "ve"} unpushed commits`;
    parts.push(s);
    const bad = local.filter((r) => !LOCAL_OK.has(r.status));
    if (bad.length) parts.push(`not synced: ${bad.map((r) => `${name(r)}: ${r.status === "not-fast-forward" ? "local and remote diverged, pull by hand" : r.error ?? r.status}`).join("; ")}`);
  }
  if (remote.length > 0) {
    const stale = remote.filter((r) => r.stale);
    parts.push(stale.length === 0
      ? `${remote.length} remote scope${remote.length === 1 ? "" : "s"} synced`
      : `${stale.length} of ${remote.length} remote scopes could not sync (using cached copy): ${stale.map((r) => `${r.scope}: ${r.error ?? "failed"}`).join("; ")}`);
  }
  return parts.length ? `${parts.join(". ")}.` : "Nothing to sync.";
}

/** Resolve symlinks for vault-membership checks. Shared with core. */
export { realOrSelf } from "@mozak/core";
