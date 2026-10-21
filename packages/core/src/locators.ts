// Locator resolution (D3 goal 3, "built regardless"): where does a plan's Source.locator or Evidence.locator point
// on this machine? Read only. No model, no stored index: the note index is built per call from the index roots.
//
// Index roots come from `indexRoots` in mozak-settings.json. Without that key they are derived from the inventory:
// the top-level folder of each git repo that holds a local scope, with a folder named "personal" private, and no
// root for a scope that is itself a repo root (a company vault is not searched by default).
// A private root returns path and title only, unless the call sets includePrivate (the usage log records that).

import { closeSync, existsSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { foldKey } from "./fold.ts";
import { commitTimes, dirtyPaths, findRepoRoot, noteIndex, noteKey, touched, wikiLinks, type NoteIndex } from "./notes.ts";
import type { ScopeEntry, ScopeInventory } from "./scope-index.ts";
import { scopeFileName } from "./scope-files.ts";
import { loadSettings, type IndexRoot } from "./settings.ts";
import type { Plan, ScopeState } from "./understanding.ts";

export interface LocatorRoot extends IndexRoot { source: "setting" | "default" }

export type LocatorKind = "url" | "git" | "path" | "wikilink" | "text";
export type LocatorStatus =
  /** A URL or git object: not checked on disk. */
  | "external"
  /** One file or folder found. */
  | "resolved"
  /** Looks like a path or note link, nothing found. */
  | "missing"
  /** A note link with several matching notes and none in the citing scope. */
  | "ambiguous"
  /** A relative path in a scope whose code lives in a remote repo that is not cloned here. */
  | "remote"
  /** Prose (an owner message, a command): nothing to resolve. */
  | "not-checked";

export interface LocatorResolution {
  kind: LocatorKind;
  status: LocatorStatus;
  /** Absolute path, when resolved. */
  path?: string;
  /** First heading, front matter title, or the file name. */
  title?: string;
  /** Inside a private index root. Only path and title are returned then. */
  private?: boolean;
  /** For a resolved Markdown note with an anchor: whether a heading matches it. null when not judged. */
  anchorFound?: boolean | null;
  /** Up to 200 characters of the anchored section or the note body. Never for private or unindexed files. */
  excerpt?: string;
  /** Paths of every matching note, for ambiguous note links. */
  candidates?: string[];
}

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const GIT_RE = /^git:/i;
const EXT_RE = /\.[A-Za-z0-9]{1,8}$/;
const READ_LIMIT = 64 * 1024;

function realOr(p: string): string { try { return realpathSync(p); } catch { return p; } }
const inside = (path: string, dir: string) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);

/** Default roots: see the header comment. Deterministic, file-system only. */
export function defaultIndexRoots(inv: ScopeInventory): LocatorRoot[] {
  const out = new Map<string, LocatorRoot>();
  for (const entry of inv.scopes) {
    if (entry.remote && entry.remote.plansMode === "repo") continue;
    const root = realOr(entry.root);
    const repo = findRepoRoot(root);
    if (!repo || repo === root) continue;
    const top = relative(repo, root).split(sep)[0];
    if (!top || top.startsWith("..")) continue;
    const path = join(repo, top);
    if (!out.has(path)) out.set(path, { path, private: foldKey(top) === "personal", source: "default" });
  }
  return [...out.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function indexRootsFor(inv: ScopeInventory): LocatorRoot[] {
  const configured = loadSettings(inv).indexRoots;
  if (configured) return configured.map((r) => ({ ...r, source: "setting" as const }));
  return defaultIndexRoots(inv);
}

/** Resolution context for one inventory: roots, plus a note index built once on first use. */
export class LocatorResolver {
  readonly roots: LocatorRoot[];
  readonly includePrivate: boolean;
  private notes: NoteIndex | null = null;
  private extraNotes = new Map<string, NoteIndex>();
  private titles = new Map<string, { title: string; text: string | null }>();

  constructor(inv: ScopeInventory, opts: { includePrivate?: boolean; roots?: LocatorRoot[] } = {}) {
    this.roots = opts.roots ?? indexRootsFor(inv);
    this.includePrivate = opts.includePrivate === true;
  }

  private noteIndexFor(scopeRoot: string): NoteIndex {
    if (!this.notes) this.notes = noteIndex(this.roots.map((r) => r.path));
    if (this.roots.some((r) => inside(scopeRoot, r.path))) return this.notes;
    // The citing scope is outside every root (a company vault): its own notes are searched too, for its own links.
    if (!this.extraNotes.has(scopeRoot)) {
      const merged: NoteIndex = new Map([...this.notes].map(([k, v]) => [k, [...v]]));
      for (const [k, v] of noteIndex([scopeRoot])) merged.set(k, [...(merged.get(k) ?? []), ...v.filter((p) => !(merged.get(k) ?? []).includes(p))]);
      this.extraNotes.set(scopeRoot, merged);
    }
    return this.extraNotes.get(scopeRoot)!;
  }

  private rootOf(path: string): LocatorRoot | null {
    let best: LocatorRoot | null = null;
    for (const r of this.roots) if (inside(path, r.path) && (!best || r.path.length > best.path.length)) best = r;
    return best;
  }

  private read(path: string): { title: string; text: string | null } {
    const hit = this.titles.get(path);
    if (hit) return hit;
    let text: string | null = null;
    let title = basename(path);
    try {
      if (statSync(path).isFile() && /\.md$/i.test(path)) {
        const fd = openSync(path, "r");
        try {
          const buf = Buffer.alloc(READ_LIMIT);
          const n = readSync(fd, buf, 0, READ_LIMIT, 0);
          const body = buf.subarray(0, n).toString("utf8");
          text = body;
          title = noteTitle(body) ?? basename(path, extname(path));
        } finally { closeSync(fd); }
      }
    } catch { /* unreadable: title stays the file name */ }
    const out = { title, text };
    this.titles.set(path, out);
    return out;
  }

  private found(path: string, anchor: string | null, scopeRoot: string, kind: LocatorKind): LocatorResolution {
    const root = this.rootOf(path);
    const isPrivate = root?.private === true;
    const indexed = root !== null || inside(path, scopeRoot);
    const { title, text } = this.read(path);
    const out: LocatorResolution = { kind, status: "resolved", path, title };
    if (isPrivate) out.private = true;
    const detail = this.includePrivate || (indexed && !isPrivate);
    if (text !== null) {
      const section = anchor ? anchoredSection(text, anchor) : null;
      out.anchorFound = anchor ? section !== null : null;
      if (detail) {
        const ex = excerptOf(section ?? stripFrontMatter(text));
        if (ex) out.excerpt = ex;
      }
    } else out.anchorFound = null;
    return out;
  }

  /** Resolve one locator cited from a scope. Never throws for odd input. */
  resolve(entry: ScopeEntry, locator: string, anchor: string | null = null): LocatorResolution {
    const raw = locator.trim();
    if (!raw) return { kind: "text", status: "not-checked" };
    if (URL_RE.test(raw)) return { kind: "url", status: "external" };
    if (GIT_RE.test(raw)) return { kind: "git", status: "external" };
    const scopeRoot = realOr(entry.root);
    const link = raw.includes("[[") ? wikiLinks(raw)[0] : undefined;
    if (link) return this.resolveNote(scopeRoot, link.target, link.anchor ?? anchor);

    let path = raw;
    let inlineAnchor: string | null = null;
    const hash = raw.indexOf("#");
    if (hash > 0) { inlineAnchor = raw.slice(hash + 1).trim() || null; path = raw.slice(0, hash); }
    path = path.replace(/:\d+(?:-\d+)?$/, "");
    const anchorUsed = inlineAnchor ?? anchor;
    const explicit = path.startsWith("/") || path.startsWith("~/") || path === "~" || path.startsWith("./") || path.startsWith("../");
    const pathLike = explicit || (!/['"`;,]|\s{2}/.test(path) && /^[^\s:]+(?: [^\s:]+){0,6}$/.test(path) && (path.includes("/") || EXT_RE.test(path)));
    if (!pathLike) return { kind: "text", status: "not-checked" };

    for (const candidate of this.candidates(entry, scopeRoot, path)) {
      if (existsSync(candidate)) return this.found(realOr(candidate), anchorUsed, scopeRoot, "path");
    }
    // A bare note name with .md may be a note anywhere in the roots, as Obsidian would find it.
    if (!path.includes("/") && /\.md$/i.test(path)) {
      const note = this.resolveNote(scopeRoot, path, anchorUsed);
      if (note.status !== "missing") return { ...note, kind: "path" };
    }
    if (!explicit && entry.remote && !entry.remote.fullClone) return { kind: "path", status: "remote" };
    return { kind: "path", status: "missing" };
  }

  private candidates(entry: ScopeEntry, scopeRoot: string, path: string): string[] {
    if (path === "~" || path.startsWith("~/")) return [join(homedir(), path.slice(1))];
    if (isAbsolute(path)) return [path];
    const bases = [scopeRoot];
    const repo = findRepoRoot(scopeRoot);
    if (repo) bases.push(repo);
    if (entry.remote?.fullClone) bases.push(entry.remote.fullClone);
    for (const r of this.roots) bases.push(dirname(r.path), r.path);
    return [...new Set(bases.map((b) => resolve(b, path)))];
  }

  private resolveNote(scopeRoot: string, target: string, anchor: string | null): LocatorResolution {
    const idx = this.noteIndexFor(scopeRoot);
    const name = target.split("/").pop() ?? target;
    let hits = idx.get(noteKey(name)) ?? [];
    if (target.includes("/")) {
      const suffix = foldKey(target.replace(/\.md$/i, "")) + ".md";
      hits = hits.filter((p) => foldKey(p).endsWith(suffix));
    }
    if (hits.length === 0) return { kind: "wikilink", status: "missing" };
    const local = hits.filter((p) => inside(realOr(p), scopeRoot));
    const pick = hits.length === 1 ? hits[0] : local.length === 1 ? local[0] : null;
    if (!pick) return { kind: "wikilink", status: "ambiguous", candidates: hits.map((p) => realOr(p)).filter((p) => this.includePrivate || !this.rootOf(p)?.private).sort() };
    return this.found(realOr(pick), anchor, scopeRoot, "wikilink");
  }
}

function stripFrontMatter(text: string): string {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 4);
  return end < 0 ? text : text.slice(end + 4);
}

/** First H1, else front matter title, else null. */
export function noteTitle(text: string): string | null {
  const fm = text.startsWith("---\n") ? text.slice(4, Math.max(4, text.indexOf("\n---", 4))) : "";
  const body = stripFrontMatter(text);
  const h1 = /^# +(.+?)\s*#*\s*$/m.exec(body.split("\n").slice(0, 60).join("\n"));
  if (h1) return h1[1].trim();
  const t = /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm);
  return t ? t[1].trim() : null;
}

const headingKey = (s: string) => foldKey(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Text under the first heading that matches the anchor (equal, or one contains the other), else null. */
export function anchoredSection(text: string, anchor: string): string | null {
  const want = headingKey(anchor.replace(/^#+/, ""));
  if (!want) return null;
  const lines = text.split("\n");
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s{0,3}(```|~~~)/.test(lines[i])) { fence = !fence; continue; }
    if (fence) continue;
    const m = /^(#{1,6}) +(.+?)\s*#*\s*$/.exec(lines[i]);
    if (!m) continue;
    const have = headingKey(m[2]);
    if (!have || !(have === want || have.includes(want) || want.includes(have))) continue;
    const level = m[1].length;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const h = /^(#{1,6}) /.exec(lines[j]);
      if (h && h[1].length <= level) break;
      body.push(lines[j]);
    }
    return body.join("\n");
  }
  return null;
}

function excerptOf(text: string): string | undefined {
  const line = text.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#") && !/^(```|~~~|---)/.test(l));
  if (!line) return undefined;
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

/** Every locator a plan cites: content sources (accepted and pending) and observation evidence. */
export interface Citation {
  planId: string;
  field: "source" | "evidence";
  id: string;
  locator: string;
  anchor: string | null;
  /** observedAt for a source, inspectedAt for evidence. */
  citedAt: string;
}

export function planCitations(plan: Plan): Citation[] {
  const out: Citation[] = [];
  const seen = new Set<string>();
  for (const rev of [plan.accepted, plan.pending]) {
    for (const s of rev?.content.sources ?? []) {
      const k = `source\0${s.id}\0${s.locator}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ planId: plan.id, field: "source", id: s.id, locator: s.locator, anchor: s.anchor, citedAt: s.observedAt });
    }
  }
  for (const o of plan.observations) for (const e of o.evidence) out.push({ planId: plan.id, field: "evidence", id: e.id, locator: e.locator, anchor: e.anchor, citedAt: e.inspectedAt });
  return out;
}

const live = (p: Plan) => p.lifecycle.state !== "completed" && !(p.lifecycle.state === "unaccepted" && p.pending?.reviewState === "rejected");

export interface CitedNoteChange {
  code: "cited-note-changed";
  message: string;
  planId: string;
  path: string;
  citedAt: string;
  changedAt: string;
  source: "commit" | "uncommitted";
}

/**
 * Cited-note staleness for `check`: a file a live plan cites (source or evidence) that changed after the latest
 * citation. Time comes from git (touched()). A citation counts from the first commit of this scope's mozak.json at or
 * after its citedAt, so a note committed while the citation itself was still uncommitted is not reported. Files
 * outside git are not judged. Informational only: a change does not mean the edit matters.
 */
export function citedNoteChanges(inv: ScopeInventory, entry: ScopeEntry, state: ScopeState, resolver = new LocatorResolver(inv)): CitedNoteChange[] {
  const latest = new Map<string, { planId: string; path: string; citedAt: string }>();
  for (const plan of state.plans) {
    if (!live(plan)) continue;
    for (const c of planCitations(plan)) {
      const r = resolver.resolve(entry, c.locator, c.anchor);
      if (r.status !== "resolved" || !r.path) continue;
      const key = `${plan.id}\0${r.path}`;
      const prev = latest.get(key);
      if (!prev || Date.parse(c.citedAt) > Date.parse(prev.citedAt)) latest.set(key, { planId: plan.id, path: r.path, citedAt: c.citedAt });
    }
  }
  if (latest.size === 0) return [];
  const graph = join(realOr(entry.root), scopeFileName(entry.root, "graph"));
  const ownRepo = findRepoRoot(entry.root);
  const recorded = ownRepo ? commitTimes(ownRepo, graph) : [];
  /** When a citation landed: the first mozak.json commit at or after citedAt, else citedAt itself. */
  const landed = (cited: number) => recorded.find((t) => t >= cited) ?? cited;
  const dirtyByRepo = new Map<string, string[]>();
  const out: CitedNoteChange[] = [];
  for (const { planId, path, citedAt } of latest.values()) {
    const repo = findRepoRoot(path);
    if (!repo) continue;
    if (!dirtyByRepo.has(repo)) dirtyByRepo.set(repo, dirtyPaths(repo));
    const t = touched(path, { root: repo, paths: dirtyByRepo.get(repo)! });
    const cited = Math.floor(Date.parse(citedAt) / 1000);
    if (t.epoch === null || t.source === "none" || !Number.isFinite(cited)) continue;
    if (t.epoch <= (t.source === "commit" ? landed(cited) : cited)) continue;
    const changedAt = new Date(t.epoch * 1000).toISOString();
    const shown = relative(repo, path) || path;
    out.push({
      code: "cited-note-changed",
      message: `plan ${planId} cites ${shown}, which changed ${changedAt.slice(0, 10)}${t.source === "uncommitted" ? " (uncommitted)" : ""} after it was cited ${citedAt.slice(0, 10)}. Changed does not mean the edit matters.`,
      planId, path, citedAt, changedAt, source: t.source,
    });
  }
  return out.sort((a, b) => a.planId.localeCompare(b.planId) || a.path.localeCompare(b.path));
}
