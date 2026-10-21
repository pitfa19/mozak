// Format-1 stale report (scope-level, from mozak.md links). The note index, wikilinks and touched() it uses live in
// notes.ts, so this file can be deleted with the rest of the format-1 code without losing them.
import { readFileSync } from "node:fs";
import { basename, sep } from "node:path";
import { buildGraph, type LocalConfig } from "./graph.ts";
import { scopeFile, isBridgeFileName } from "./scope-files.ts";
import { gitRoot, mdFiles, NO_TOUCH as NONE, touched, wikiNames, type Touched } from "./notes.ts";
export interface Upstream {
  id: string;
  /** How the scope relates to it, from this scope's point of view. */
  relation: string;
  /** declared: this scope names it. reverse: it names this scope with informs or translates-to. */
  direction: "declared" | "reverse";
  touched: Touched;
  /** Seconds newer than this scope, when it changed after it. */
  newerBy: number | null;
}

export interface NoteChange {
  name: string;
  path: string;
  touched: Touched;
  newerBy: number | null;
}

export interface StaleReport {
  id: string;
  kind: "project" | "topic";
  dir: string;
  touched: Touched;
  daysSinceTouched: number | null;
  upstream: Upstream[];
  notes: NoteChange[];
  /** Links this scope declares upstream that do not resolve on this machine, so staleness cannot be judged. */
  unresolved: string[];
  verdict: "inputs-changed" | "no-input-changed" | "unknown";
}

export interface StaleOptions {
  /** Only compare each scope's mozak.md, not every file in the scope. Quieter for busy code repos. */
  planOnly?: boolean;
  now?: number;
}

/** For each scope (or one), say what changed after it was last touched. Read only. */
export function staleReports(config: LocalConfig, only?: string, opts: StaleOptions = {}): StaleReport[] {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const graph = buildGraph(config);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const scopeTouched = (id: string): Touched => {
    const n = byId.get(id);
    if (!n) return NONE;
    return touched(opts.planOnly ? scopeFile(n.dir, "bridge") : n.dir);
  };
  const noteIndex = new Map<string, Map<string, string>>(); // repo root -> lowercase basename -> path

  const reports: StaleReport[] = [];
  for (const node of graph.nodes) {
    if (only && node.id !== only) continue;
    const own = scopeTouched(node.id);
    const newer = (t: Touched) => (own.epoch !== null && t.epoch !== null && t.epoch > own.epoch ? t.epoch - own.epoch : null);

    const upstream: Upstream[] = [];
    const unresolved: string[] = [];
    for (const e of graph.edges) {
      if (e.from === node.id && (e.relation === "depends-on" || e.relation === "derived-from")) {
        if (!e.to) {
          unresolved.push(`${e.relation}: ${e.target}`);
          continue;
        }
        const t = scopeTouched(e.to);
        upstream.push({ id: e.to, relation: e.relation, direction: "declared", touched: t, newerBy: newer(t) });
      } else if (e.to === node.id && (e.relation === "informs" || e.relation === "translates-to")) {
        const t = scopeTouched(e.from);
        upstream.push({ id: e.from, relation: e.relation, direction: "reverse", touched: t, newerBy: newer(t) });
      }
    }

    // Note level: wikilinks in this scope's own files that point at notes elsewhere in the same repo.
    const notes: NoteChange[] = [];
    const root = gitRoot(node.dir);
    if (root) {
      if (!noteIndex.has(root)) {
        const idx = new Map<string, string>();
        for (const f of mdFiles(root).sort()) {
          const key = basename(f, ".md").toLowerCase();
          if (!idx.has(key)) idx.set(key, f);
        }
        noteIndex.set(root, idx);
      }
      const idx = noteIndex.get(root)!;
      const seen = new Set<string>();
      for (const f of mdFiles(node.dir)) {
        if (isBridgeFileName(basename(f))) continue;
        for (const name of wikiNames(readFileSync(f, "utf8"))) {
          const target = idx.get(name.toLowerCase());
          if (!target || target.startsWith(node.dir + sep) || seen.has(target)) continue;
          seen.add(target);
          const t = touched(target);
          notes.push({ name, path: target, touched: t, newerBy: newer(t) });
        }
      }
    }

    const changed = upstream.some((u) => u.newerBy !== null) || notes.some((n) => n.newerBy !== null);
    reports.push({
      id: node.id,
      kind: node.kind,
      dir: node.dir,
      touched: own,
      daysSinceTouched: own.epoch === null ? null : Math.floor((now - own.epoch) / 86400),
      upstream: upstream.sort((a, b) => a.id.localeCompare(b.id)),
      notes: notes.sort((a, b) => a.name.localeCompare(b.name)),
      unresolved,
      verdict: own.epoch === null ? "unknown" : changed ? "inputs-changed" : "no-input-changed",
    });
  }
  return reports.sort((a, b) => a.id.localeCompare(b.id));
}

const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
const days = (s: number) => `+${Math.max(1, Math.round(s / 86400))}d`;

export function renderStale(reports: StaleReport[]): string {
  const out: string[] = [];
  for (const r of reports) {
    const when = r.touched.epoch === null ? "no git history" : `last touched ${day(r.touched.epoch)} (${r.daysSinceTouched}d ago, ${r.touched.source})`;
    const flag = r.verdict === "inputs-changed" ? "  [inputs changed]" : r.verdict === "unknown" ? "  [unknown]" : "";
    out.push(`${r.id} (${r.kind}): ${when}${flag}`);
    for (const u of r.upstream.filter((x) => x.newerBy !== null)) {
      out.push(`  ${u.id}  ${u.direction === "declared" ? r.id + " " + u.relation : u.id + " " + u.relation + " " + r.id}  changed ${day(u.touched.epoch!)} ${days(u.newerBy!)}`);
    }
    for (const n of r.notes.filter((x) => x.newerBy !== null)) out.push(`  note [[${n.name}]]  changed ${day(n.touched.epoch!)} ${days(n.newerBy!)}`);
    for (const u of r.unresolved) out.push(`  cannot judge, not found on this machine: ${u}`);
  }
  if (reports.some((r) => r.verdict === "inputs-changed")) out.push("\nChanged means a linked input was edited after this scope. It does not mean the edit matters.");
  return out.join("\n");
}
