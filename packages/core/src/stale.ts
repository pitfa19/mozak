import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { buildGraph, type LocalConfig } from "./graph.ts";
import { scopeFile, isBridgeFileName } from "./scope-files.ts";

/** When something was last changed, derived from git. Nothing is stored, so there is no timestamp to forget to update. */
export interface Touched {
  /** Unix seconds, or null when nothing is known. */
  epoch: number | null;
  /** commit: last commit. uncommitted: working tree is newer than the last commit. none: no git history. */
  source: "commit" | "uncommitted" | "none";
}

const NONE: Touched = { epoch: null, source: "none" };
// Every dot folder (.git, the Obsidian config folder, ...) is skipped by the walk below as well.
const SKIP = new Set(["node_modules", "dist", "target"]);

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null; // not a repo, or git is missing
  }
}

export function gitRoot(dir: string): string | null {
  const out = git(dir, ["rev-parse", "--show-toplevel"]);
  return out ? realpathSync(out.trim()) : null;
}

/** Paths with uncommitted changes (modified or untracked), relative to the repo root. */
function dirtyPaths(root: string): string[] {
  const out = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (!out) return [];
  const parts = out.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    paths.push(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") i++; // renames carry the old path as the next field
  }
  return paths;
}

/** Last change to a file or directory. A directory counts any file inside it. */
export function touched(target: string): Touched {
  if (!existsSync(target)) return NONE;
  const real = realpathSync(target);
  const root = gitRoot(statSync(real).isDirectory() ? real : join(real, ".."));
  if (!root) return NONE;
  const rel = relative(root, real) || ".";
  const logged = git(root, ["log", "-1", "--format=%ct", "--", rel]);
  const committed = logged && logged.trim() ? Number(logged.trim()) : null;
  let dirty: number | null = null;
  for (const p of dirtyPaths(root)) {
    if (rel !== "." && p !== rel && !p.startsWith(rel + sep) && !p.startsWith(rel + "/")) continue;
    try {
      const m = Math.floor(statSync(join(root, p)).mtimeMs / 1000);
      if (dirty === null || m > dirty) dirty = m;
    } catch {
      /* deleted file, no mtime to read */
    }
  }
  if (dirty !== null && (committed === null || dirty > committed)) return { epoch: dirty, source: "uncommitted" };
  return committed !== null ? { epoch: committed, source: "commit" } : NONE;
}

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

function mdFiles(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) mdFiles(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function wikiNames(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/\[\[([^\]|#\n]+)/g)) names.add(m[1].trim());
  return [...names];
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
