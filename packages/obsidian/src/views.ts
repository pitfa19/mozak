import { ItemView, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import { countRemote, defaultFilter, FILTERS, planMatches, scopesModel, type PlanFilter, type PlanVM, type RefVM, type ScopeVM, type ScopesModel, type StripVM } from "./model.ts";
import { loadScopesModel, describeError, syncAll, toggleFocus } from "./load.ts";
import type MozakPlugin from "./main.ts";
import { cachedUpdateNotice } from "@mozak/core";

export const SCOPES_VIEW_TYPE = "mozak-scopes";
/** Retired detail tab. Kept only so leftover leaves from older versions can be closed on load. */
export const LEGACY_PLAN_VIEW_TYPE = "mozak-plan";

function el(parent: HTMLElement, tag: string, cls?: string, text?: string): HTMLElement {
  const e = parent.createEl(tag as keyof HTMLElementTagNameMap, { cls });
  if (text !== undefined) e.setText(text);
  return e;
}

const EMPTY: Record<PlanFilter, string> = { open: "No open plans. Nice.", focus: "Star a plan to focus on it", completed: "No completed plans yet." };

/** "github:owner/repo" or an https URL to a browsable GitHub URL. Null for file:// remotes. */
function repoUrl(spec: string): string | null {
  if (spec.startsWith("github:")) return `https://github.com/${spec.slice(7)}`;
  if (spec.startsWith("https://")) return spec.replace(/\.git$/, "");
  return null;
}

function repoLabel(spec: string): string {
  return spec.replace(/^github:/, "").replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
}

function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/** Scopes with open plans first, then ones with only completed plans, then empty, then failed. Stable within a group. */
function rank(s: ScopeVM): number {
  if (s.status === "failed") return 3;
  if (s.plans.some((p) => planMatches(p, "open"))) return 0;
  return s.plans.length ? 1 : 2;
}

export class ScopesView extends ItemView {
  private model: ScopesModel | null = null;
  private error: string | null = null;
  private collapsed = new Set<string>();
  /** Null until the first model loads; then the remembered tab, else Focus when it has plans, else Open. */
  private filter: PlanFilter | null = null;

  private plugin: MozakPlugin;
  constructor(leaf: WorkspaceLeaf, plugin: MozakPlugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return SCOPES_VIEW_TYPE; }
  getDisplayText() { return "mozak scopes"; }
  override getIcon() { return "brain-circuit"; }

  override async onOpen(): Promise<void> { this.refresh(); }

  refresh(): void {
    const choice = this.plugin.inventory();
    this.model = null;
    this.error = null;
    if (!choice.path) {
      this.error = "No mozak-inventory.json found above this vault. Set the inventory path in the mozak plugin settings.";
    } else {
      try {
        this.model = loadScopesModel(choice.path);
      } catch (err) {
        const d = describeError(err);
        this.error = `${d.message} (${d.code})`;
      }
    }
    if (this.model && this.filter === null) this.filter = defaultFilter(this.model.scopes.flatMap((s) => s.plans), this.plugin.settings.lastFilter);
    this.render();
  }

  /** Remember the tab across restarts in the plugin settings. */
  private setFilter(filter: PlanFilter): void {
    this.filter = filter;
    this.plugin.settings.lastFilter = filter;
    void this.plugin.saveSettings();
    this.render();
  }

  /** Star or unstar one plan through core's setFocus, then reload so every tab sees it. */
  private toggleStar(scope: ScopeVM, plan: PlanVM): void {
    const path = this.plugin.inventory().path;
    if (!path) return;
    const out = toggleFocus(path, scope.id, plan.id, plan.focused);
    if (!out.ok) new Notice(`mozak: could not ${plan.focused ? "unstar" : "star"} ${plan.title}: ${out.message}`, 10000);
    this.refresh();
  }

  private syncRemote(button: HTMLElement): void {
    const path = this.plugin.inventory().path;
    if (!path) return;
    button.addClass("is-busy");
    button.setAttr("disabled", "true");
    // Let the label paint before the synchronous core call blocks the UI thread.
    window.setTimeout(() => {
      try {
        const result = syncAll(path);
        new Notice(`mozak: ${result.message}`, result.ok ? 4000 : 10000);
      } catch (err) {
        const d = describeError(err);
        new Notice(`mozak: sync failed: ${d.message}`, 10000);
      }
      this.refresh();
    }, 30);
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("mozak-root");
    const filter = this.filter ?? "open";
    const head = el(root, "div", "mozak-header");
    const title = el(head, "span", "mozak-title");
    setIcon(el(title, "span", `mozak-title-icon icon-${filter}`), this.getIcon());
    el(title, "span", undefined, "mozak");
    const tools = el(head, "div", "mozak-tools");
    if (this.model && this.model.scopes.length > 0) {
      const sync = el(tools, "button", "clickable-icon mozak-sync");
      sync.setAttr("aria-label", "Sync vaults and repos");
      setIcon(sync, "cloud-download");
      sync.addEventListener("click", () => this.syncRemote(sync));
    }
    const btn = el(tools, "button", "clickable-icon mozak-refresh");
    btn.setAttr("aria-label", "Refresh (regenerates stale mozak.md files)");
    setIcon(btn, "refresh-cw");
    btn.addEventListener("click", () => { this.plugin.renderProjections(); this.refresh(); });

    if (this.error) {
      const box = el(root, "div", "mozak-empty");
      el(box, "div", "mozak-empty-title", "Cannot load mozak");
      el(box, "div", "mozak-muted", this.error);
      return;
    }
    const m = this.model;
    if (!m) return;
    // Reads the shared update cache only; the plugin never checks the network itself.
    const update = cachedUpdateNotice(this.plugin.manifest.version);
    if (update) el(root, "div", "mozak-update", `mozak ${update.latest} available. Run: ${update.command}`);
    this.renderFilter(root, m);
    const stale = countRemote(m.scopes).stale;
    if (m.totals.failed || stale) {
      el(root, "div", "mozak-warn",
        [m.totals.failed ? `${m.totals.failed} unreadable` : "", stale ? `${stale} remote stale` : ""].filter(Boolean).join(", "));
    }
    const visible = m.scopes.filter((s) => s.plans.some((p) => planMatches(p, filter))).sort((a, b) => rank(a) - rank(b));
    if (visible.length === 0) {
      el(root, "div", "mozak-muted mozak-none", EMPTY[filter]);
      return;
    }
    const list = el(root, "div", "mozak-list-scopes");
    const notes = visible.filter((s) => !s.remote);
    const repos = visible.filter((s) => s.remote);
    if (repos.length && notes.length) el(list, "div", "mozak-group", "Notes");
    for (const scope of notes) this.renderScope(list, scope);
    if (repos.length) {
      const g = el(list, "div", "mozak-group");
      setIcon(el(g, "span", "mozak-group-icon"), "github");
      el(g, "span", undefined, "Repos");
    }
    for (const scope of repos) this.renderScope(list, scope);
  }

  private renderFilter(root: HTMLElement, m: ScopesModel): void {
    const all = m.scopes.flatMap((s) => s.plans);
    const bar = el(root, "div", "mozak-filter");
    bar.setAttr("role", "tablist");
    for (const f of FILTERS) {
      const n = all.filter((p) => planMatches(p, f.id)).length;
      const pill = el(bar, "button", `mozak-pill pill-${f.id}${this.filter === f.id ? " is-active" : ""}`);
      pill.setAttr("role", "tab");
      pill.setAttr("aria-selected", String(this.filter === f.id));
      pill.setAttr("aria-label", f.tip);
      el(pill, "span", "mozak-pill-label", f.label);
      el(pill, "span", "mozak-pill-count", String(n));
      pill.addEventListener("click", () => this.setFilter(f.id));
    }
  }

  private renderScope(parent: HTMLElement, scope: ScopeVM): void {
    // Every tab only shows scopes with matching plans, so they start open to show those plans directly.
    const filter = this.filter ?? "open";
    const open = !this.collapsed.has(scope.id);
    const openN = scope.plans.filter((p) => planMatches(p, "open")).length;
    const doneN = scope.plans.filter((p) => planMatches(p, "completed")).length;
    const empty = scope.status === "ok" && scope.plans.length === 0;
    const box = el(parent, "div", "mozak-scope" + (scope.status === "failed" ? " is-failed" : "") + (empty ? " is-empty" : "") + (open ? " is-open" : ""));
    const row = el(box, "div", "mozak-scope-row");
    row.setAttr("title", `${scope.title}\n${scope.id} (${scope.kind})\n${scope.root}`);
    const chev = el(row, "span", "mozak-chevron");
    setIcon(chev, open ? "chevron-down" : "chevron-right");
    if (scope.remote) {
      const r = el(row, "span", "mozak-tag mozak-remote" + (scope.remote.stale ? " is-stale" : ""));
      setIcon(r, "github");
      r.setAttr("aria-label", `${repoLabel(scope.remote.spec)}${scope.remote.stale ? " (cached copy is stale)" : ""}`);
      const vis = scope.remote.visibility;
      if (vis) {
        const v = el(row, "span", `mozak-tag mozak-vis is-${vis}`);
        setIcon(v, vis === "public" ? "globe" : "lock");
        const where = scope.remote.vault ? "plans private in your vault" : "plans shared inside the repo";
        v.setAttr("aria-label", `${vis === "public" ? "Public repo" : "Private repo"}, ${where}`);
      }
    }
    el(row, "span", "mozak-scope-title", scope.title);
    const counts = el(row, "span", "mozak-counts");
    if (scope.status === "failed") {
      const e = el(counts, "span", "mozak-count is-error");
      setIcon(e, "alert-triangle");
    } else {
      if (openN) el(counts, "span", "mozak-count c-open", String(openN)).setAttr("aria-label", `${openN} open`);
      if (doneN) el(counts, "span", "mozak-count c-done", String(doneN)).setAttr("aria-label", `${doneN} completed`);
    }
    if (scope.hasMozakMd) {
      const md = el(row, "span", "clickable-icon mozak-md");
      setIcon(md, "file-text");
      md.setAttr("aria-label", `Open ${scope.bridgeFile ?? "mozak.md"}`);
      md.addEventListener("click", (ev) => { ev.stopPropagation(); void this.plugin.openMozakMd(scope); });
    }
    row.addEventListener("click", () => {
      if (open) this.collapsed.add(scope.id); else this.collapsed.delete(scope.id);
      this.render();
    });
    if (!open) return;
    const body = el(box, "div", "mozak-plans");
    if (scope.remote) {
      const links = el(body, "div", "mozak-repo-links");
      const url = repoUrl(scope.remote.spec);
      if (url) {
        const gh = el(links, "a", "mozak-repo-link");
        setIcon(el(gh, "span", "mozak-repo-link-icon"), "external-link");
        el(gh, "span", undefined, repoLabel(scope.remote.spec));
        gh.setAttr("href", url);
        gh.setAttr("aria-label", "Open on GitHub");
      }
      if (scope.entryFiles.includes("README.md")) {
        const rd = el(links, "span", "mozak-repo-link");
        setIcon(el(rd, "span", "mozak-repo-link-icon"), "book-open");
        el(rd, "span", undefined, "README");
        rd.addEventListener("click", () => void this.plugin.openScopeFile(scope, "README.md"));
      }
      if (scope.remote.stale) el(links, "span", "mozak-stale-note", scope.remote.lastFetchAt ? `cached ${ago(scope.remote.lastFetchAt)}` : "not fetched yet");
    }
    if (scope.status === "failed") el(body, "div", "mozak-error", `${scope.errorCode}: ${scope.errorMessage}`);
    if (empty) el(body, "div", "mozak-muted mozak-noplans", "No plans yet");
    for (const plan of scope.plans.filter((p) => planMatches(p, filter))) {
      const p = el(body, "div", `mozak-plan-row row-${plan.state}`);
      p.setAttr("title", `${plan.stateLabel}: ${plan.title}${plan.strip ? `\n${plan.strip.done}/${plan.strip.total} outcomes done` : ""}\nOpen in ${scope.bridgeFile ?? "mozak.md"}`);
      const star = el(p, "span", `clickable-icon mozak-star${plan.focused ? " is-focused" : ""}`);
      setIcon(star, "star");
      star.setAttr("aria-label", plan.focused ? "Remove from Focus" : "Add to Focus");
      star.setAttr("aria-pressed", String(plan.focused));
      // The star only edits the focus list; the row click still opens the plan.
      star.addEventListener("click", (ev) => { ev.stopPropagation(); this.toggleStar(scope, plan); });
      el(p, "span", `mozak-dot dot-${plan.state}`);
      el(p, "span", "mozak-plan-title", plan.title);
      if (plan.state === "awaiting" || plan.state === "paused" || plan.state === "rejected") {
        el(p, "span", `mozak-mini state-${plan.state}`, plan.stateLabel);
      } else if (plan.state === "open" && plan.strip) {
        renderStrip(p, plan.strip);
      }
      p.addEventListener("click", () => void this.plugin.openPlan(scope, plan));
      if (plan.refs?.length) renderRefs(body, plan.refs);
    }
  }
}

/** Incoming and outgoing owner annotation refs under a plan row. Display only; annotations change only by `mozak annotate`. */
function renderRefs(parent: HTMLElement, refs: RefVM[]): void {
  const box = el(parent, "div", "mozak-plan-refs");
  for (const ref of refs) {
    const item = el(box, "span", `mozak-ref ref-${ref.direction} ref-${ref.status}`, `${ref.direction === "out" ? "→" : "←"} ${ref.verb} ${ref.label}${ref.status === "resolved" ? "" : ` (${ref.status})`}`);
    item.setAttr("title", `${ref.other}\n${ref.evidence}`);
  }
}

/** One segment per outcome (done green, evidence gold, current purple, todo faint), then done/total. Display only. */
function renderStrip(parent: HTMLElement, strip: StripVM): void {
  const s = el(parent, "span", "mozak-strip");
  s.setAttr("aria-label", `${strip.done} of ${strip.total} outcomes done`);
  const segs = el(s, "span", "mozak-strip-segs");
  for (const stop of strip.stops) el(segs, "span", `mozak-seg seg-${stop.key}`).setAttr("title", stop.label);
  el(s, "span", "mozak-strip-count", `${strip.done}/${strip.total}`);
}

export { scopesModel };
