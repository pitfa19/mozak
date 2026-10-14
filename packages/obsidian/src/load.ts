// Impure loader. Reuses core for parsing and validation: loadInventory, resolveScope, readScope, reviewRows
// (the same functions behind `mozak scopes` and `mozak plans`). Read-only: nothing here writes.
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DomainError, loadInventory, readScope, resolveScope, reviewRows } from "@mozak/core";
import { scopesModel, type ScopeLoad, type ScopesModel } from "./model.ts";

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
      };
    } catch (err) {
      return { id: entry.id, root: entry.root, entryFiles: entryFiles(entry.root), error: fail(err) };
    }
  });
  return scopesModel(inventoryPath, loads);
}

export { fail as describeError };
