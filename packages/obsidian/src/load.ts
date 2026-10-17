// Impure loader. Reuses core for parsing and validation: loadInventory, resolveScope, readScope, reviewRows
// (the same functions behind `mozak scopes` and `mozak plans`). Reading never writes. The single write path,
// renderStaleProjections, regenerates MOZAK.md through core and never touches MOZAK.json.
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DomainError, executeOperation, loadInventory, readRemoteMeta, readScope, resolveScope, reviewRows } from "@mozak/core";
import { remoteVM, scopesModel, type ScopeLoad, type ScopesModel } from "./model.ts";

const ENTRY_NAMES = ["AGENTS.md", "MOZAK.json", "MOZAK.md", "README.md"];

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
      ? remoteVM(entry.remote.spec, entry.remote.ref, readRemoteMeta(entry.remote.baseDir, entry.id))
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
 * Regenerate stale MOZAK.md projections through core's render operation (the same code as `mozak render --all`).
 * The only write the plugin makes: MOZAK.md of local scopes, never MOZAK.json. Conflicts are reported, not overwritten.
 */
export function renderStaleProjections(inventoryPath: string): { ok: boolean; rendered: number; message: string } {
  const inv = loadInventory(inventoryPath);
  const out = executeOperation(inv, "render", { all: true }, "agent");
  const rows = (out.data.scopes ?? []) as { scope: string; result: string }[];
  const rendered = rows.filter((r) => r.result === "rendered").length;
  const bad = rows.filter((r) => r.result === "conflict" || r.result === "failed");
  if (bad.length === 0) return { ok: true, rendered, message: rendered ? `Regenerated ${rendered} MOZAK.md file${rendered === 1 ? "" : "s"}.` : "All MOZAK.md files are current." };
  return { ok: false, rendered, message: `MOZAK.md not regenerated for ${bad.map((r) => `${r.scope} (${r.result === "conflict" ? "edited by hand, needs owner repair" : "unreadable"})`).join(", ")}.` };
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
