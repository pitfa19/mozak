// Read-only index of every inventoried scope. Lists identity, location, plan counts and which entry
// documents exist, so an agent can navigate a workspace. It never returns plan text, observations,
// evidence or owner decisions, and it writes nothing. A scope that cannot be read is reported with
// its error code and never omitted.

import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DomainError } from "./errors.ts";
import { resolveScope, type ScopeInventory } from "./scope-index.ts";
import { readScope } from "./scope-store.ts";
import { reviewRows } from "./review.ts";

const ENTRY_NAMES = ["AGENTS.md", "MOZAK.json", "MOZAK.md", "README.md"] as const;

export interface ScopeIndexRow {
  id: string;
  root: string;
  status: "ok" | "failed";
  /** Present only when status is "failed". */
  code?: string;
  message?: string;
  title?: string;
  kind?: "project" | "topic";
  plans?: { completed: number; open: number; awaiting: number };
  /** Which of AGENTS.md, MOZAK.json, MOZAK.md and README.md exist as regular files in the root. */
  entryFiles: string[];
}

export interface ScopeIndex {
  inventory: string;
  coverage: { selected: number; ok: number; failed: number; complete: boolean };
  scopes: ScopeIndexRow[];
}

/** Names of the known entry documents that exist as regular, non-symlink files. Never lists other files. */
function entryFilesOf(root: string): string[] {
  let present: Set<string>;
  try {
    present = new Set(readdirSync(root));
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const name of ENTRY_NAMES) {
    if (!present.has(name)) continue;
    try {
      const st = lstatSync(join(root, name));
      if (st.isFile() && !st.isSymbolicLink()) found.push(name);
    } catch {
      /* unreadable entries are simply not listed */
    }
  }
  return found;
}

function failedRow(id: string, root: string, err: DomainError): ScopeIndexRow {
  return { id, root, status: "failed", code: err.code, message: err.message, entryFiles: entryFilesOf(root) };
}

export function scopeIndex(inv: ScopeInventory): ScopeIndex {
  const scopes: ScopeIndexRow[] = [];
  for (const entry of inv.scopes) {
    try {
      const resolved = resolveScope(inv, entry.id);
      const read = readScope(resolved);
      const groups = reviewRows(read.state);
      scopes.push({
        id: entry.id,
        root: resolved.root,
        status: "ok",
        title: read.state.scope.title,
        kind: read.state.scope.kind,
        plans: { completed: groups.completed.length, open: groups.open.length, awaiting: groups.awaiting.length },
        entryFiles: entryFilesOf(resolved.root),
      });
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      scopes.push(failedRow(entry.id, entry.root, err));
    }
  }
  const ok = scopes.filter((s) => s.status === "ok").length;
  return {
    inventory: inv.digest,
    coverage: { selected: scopes.length, ok, failed: scopes.length - ok, complete: ok === scopes.length },
    scopes,
  };
}
