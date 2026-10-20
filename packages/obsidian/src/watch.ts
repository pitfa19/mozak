// Auto-refresh support. Watches the files that change when a plan changes and calls back once, debounced.
// Local scopes: <scope root>/mozak.json (or pre-0.4 MOZAK.json). Remote scopes: the sparse cache copy of it (a sync rewrites it),
// plus the cache metadata. The inventory file itself is watched too. Read-only: nothing here writes.
import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import { loadInventory, resolveScope, GRAPH_FILE, LEGACY_GRAPH_FILE } from "@mozak/core";

export interface WatchTarget { dir: string; match: (file: string) => boolean }

/** Directories and filename filters to watch for one inventory. Never throws: unreadable scopes are skipped. */
export function watchTargets(inventoryPath: string): WatchTarget[] {
  const targets = new Map<string, Set<string>>();
  const add = (dir: string, name: string) => {
    const set = targets.get(dir) ?? new Set<string>();
    set.add(name);
    targets.set(dir, set);
  };
  add(dirname(inventoryPath), basename(inventoryPath));
  try {
    const inv = loadInventory(inventoryPath);
    for (const entry of inv.scopes) {
      let root = entry.root;
      try { root = resolveScope(inv, entry.id).root; } catch { /* fall back to the declared root */ }
      if (root) { add(root, GRAPH_FILE); add(root, LEGACY_GRAPH_FILE); }
      if (entry.remote && entry.remote.plansMode === "repo") add(`${entry.remote.baseDir}/.mozak-cache`, `${entry.id}.meta.json`);
    }
  } catch { /* an unreadable inventory is reported by the view, the inventory file watch still fires */ }
  return [...targets].map(([dir, names]) => ({ dir, match: (f: string) => names.has(f) }));
}

/** Starts watchers. Returns a stop function. Bursts of events collapse into one call after `debounceMs`. */
export function startWatching(targets: WatchTarget[], onChange: () => void, debounceMs = 400): () => void {
  const watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; onChange(); }, debounceMs);
  };
  for (const t of targets) {
    try {
      const w = watch(t.dir, { persistent: false }, (_event, file) => {
        if (file === null || file === undefined || t.match(String(file))) fire();
      });
      w.on("error", () => { /* directory removed: ignore */ });
      watchers.push(w);
    } catch { /* directory missing: skip */ }
  }
  return () => {
    if (timer) clearTimeout(timer);
    for (const w of watchers) { try { w.close(); } catch { /* already closed */ } }
  };
}
