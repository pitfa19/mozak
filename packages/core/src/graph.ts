import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { checkScope } from "./check.ts";
import type { Link, MozakDoc } from "./parse.ts";
import { scopeFile } from "./scope-files.ts";

/** Local, per machine mapping. mozak.md itself only ever stores portable links. */
export interface LocalConfig {
  /** Directories searched (recursively) for scopes, e.g. an Obsidian repo and a folder of clones. */
  roots: string[];
  /** Optional explicit link target to local scope directory, for links that cannot be matched by id. */
  map?: Record<string, string>;
}

export interface GraphNode {
  id: string;
  kind: "project" | "topic";
  dir: string;
  ok: boolean;
}

export interface GraphEdge {
  from: string;
  relation: Link["relation"];
  target: string;
  /** Scope id the target resolved to, or null when it does not resolve on this machine. */
  to: string | null;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  problems: string[];
}

const SKIP = new Set([".git", "node_modules", ".obsidian", "dist", "target"]);

export function loadConfig(path: string): LocalConfig {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<LocalConfig>;
  if (!Array.isArray(raw.roots) || raw.roots.some((r) => typeof r !== "string")) {
    throw new Error(`${path}: "roots" must be an array of directory paths`);
  }
  return { roots: raw.roots.map((r) => resolve(r)), map: raw.map };
}

/** Find every directory under the roots that holds a mozak.md (or pre-0.4 MOZAK.md). Reads local files only. */
export function discoverScopes(roots: string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    if (existsSync(scopeFile(dir, "bridge"))) found.push(dir);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP.has(name) || name.startsWith(".")) continue;
      const p = join(dir, name);
      try {
        if (statSync(p).isDirectory()) walk(p, depth + 1);
      } catch {
        /* unreadable, skip */
      }
    }
  };
  for (const r of roots) walk(resolve(r), 0);
  return found;
}

/** Name a link target would match by id: the wikilink text, or the last URL path segment. */
export function targetKey(target: string): string {
  const w = /^\[\[([^\]|#]+)/.exec(target);
  if (w) return w[1].trim();
  return basename(target.replace(/\/+$/, "")).replace(/\.git$/, "");
}

export function buildGraph(config: LocalConfig): Graph {
  const problems: string[] = [];
  const nodes: GraphNode[] = [];
  const docs = new Map<string, MozakDoc>();
  const byDir = new Map<string, string>();

  for (const dir of discoverScopes(config.roots)) {
    const r = checkScope(dir);
    if (!r.doc || !r.doc.id) {
      problems.push(`${dir}: mozak.md has no usable id`);
      continue;
    }
    if (docs.has(r.doc.id)) {
      problems.push(`duplicate scope id "${r.doc.id}" in ${byDir.get(r.doc.id)} and ${dir}`);
      continue;
    }
    docs.set(r.doc.id, r.doc);
    byDir.set(r.doc.id, dir);
    nodes.push({ id: r.doc.id, kind: r.doc.kind, dir, ok: r.ok });
  }

  const dirToId = new Map([...byDir].map(([id, dir]) => [resolve(dir), id]));
  const edges: GraphEdge[] = [];
  for (const [id, doc] of docs) {
    for (const link of doc.links) {
      const mapped = config.map?.[link.target];
      const viaMap = mapped ? dirToId.get(resolve(mapped)) ?? null : null;
      const key = targetKey(link.target);
      const viaId = docs.has(key) ? key : null;
      edges.push({ from: id, relation: link.relation, target: link.target, to: viaMap ?? viaId });
    }
  }
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.target.localeCompare(b.target));
  nodes.sort((a, b) => a.id.localeCompare(b.id));
  return { nodes, edges, problems };
}

export function renderText(g: Graph): string {
  const out: string[] = [];
  for (const n of g.nodes) {
    out.push(`${n.id} (${n.kind})${n.ok ? "" : "  [check failed]"}`);
    for (const e of g.edges.filter((x) => x.from === n.id)) {
      out.push(`  ${e.relation} -> ${e.to ?? `${e.target}  [unresolved here]`}`);
    }
  }
  for (const p of g.problems) out.push(`! ${p}`);
  return out.join("\n");
}

export function renderMermaid(g: Graph): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_");
  const out = ["graph LR"];
  for (const n of g.nodes) out.push(`  ${safe(n.id)}["${n.id}"]`);
  for (const e of g.edges) {
    if (e.to) out.push(`  ${safe(e.from)} -->|${e.relation}| ${safe(e.to)}`);
  }
  return out.join("\n");
}
