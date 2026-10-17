import { ItemView, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import { countRemote, planMatches, scopesModel, type PlanFilter, type PlanVM, type ScopeVM, type ScopesModel, type StripVM } from "./model.ts";
import { loadScopesModel, describeError, syncRemoteScopes } from "./load.ts";
import type MozakPlugin from "./main.ts";

export const SCOPES_VIEW_TYPE = "mozak-scopes";
/** Retired detail tab. Kept only so leftover leaves from older versions can be closed on load. */
export const LEGACY_PLAN_VIEW_TYPE = "mozak-plan";

function el(parent: HTMLElement, tag: string, cls?: string, text?: string): HTMLElement {
  const e = parent.createEl(tag as keyof HTMLElementTagNameMap, { cls });
  if (text !== undefined) e.setText(text);
  return e;
}

const FILTERS: { id: PlanFilter; label: string; tip: string }[] = [
  { id: "all", label: "All", tip: "All plans" },
  { id: "open", label: "Open", tip: "Open, awaiting approval or paused" },
  { id: "completed", label: "Done", tip: "Completed plans" },
];

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
  private expanded = new Set<string>();
  private collapsed = new Set<string>();
  private filter: PlanFilter = "all";

  private plugin: MozakPlugin;
  constructor(leaf: WorkspaceLeaf, plugin: MozakPlugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return SCOPES_VIEW_TYPE; }
  getDisplayText() { return "MOZAK scopes"; }
  getIcon() { return "brain-circuit"; }

  async onOpen(): Promise<void> { this.refresh(); }

  refresh(): void {
    const choice = this.plugin.inventory();
    this.model = null;
    this.error = null;
    if (!choice.path) {
      this.error = "No mozak-inventory.json found above this vault. Set the inventory path in the MOZAK plugin settings.";
    } else {
      try {
        this.model = loadScopesModel(choice.path);
      } catch (err) {
        const d = describeError(err);
        this.error = `${d.message} (${d.code})`;
      }
    }
    this.render();
  }

  private syncRemote(button: HTMLElement): void {
    const path = this.plugin.inventory().path;
    if (!path) return;
    button.addClass("is-busy");
    button.setAttr("disabled", "true");
    // Let the label paint before the synchronous core call blocks the UI thread.
    setTimeout(() => {
      try {
        const result = syncRemoteScopes(path);
        new Notice(`MOZAK: ${result.message}`, result.ok ? 4000 : 10000);
      } catch (err) {
        const d = describeError(err);
        new Notice(`MOZAK: sync failed: ${d.message}`, 10000);
      }
      this.refresh();
    }, 30);
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("mozak-root");
    const head = el(root, "div", "mozak-header");
    const title = el(head, "span", "mozak-title");
    setIcon(el(title, "span", `mozak-title-icon icon-${this.filter}`), this.getIcon());
    el(title, "span", undefined, "MOZAK");
    const tools = el(head, "div", "mozak-tools");
    if (this.model && countRemote(this.model.scopes).remote > 0) {
      const sync = el(tools, "button", "clickable-icon mozak-sync");
      sync.setAttr("aria-label", "Sync remote scopes");
      setIcon(sync, "cloud-download");
      sync.addEventListener("click", () => this.syncRemote(sync));
    }
    const btn = el(tools, "button", "clickable-icon mozak-refresh");
    btn.setAttr("aria-label", "Refresh (regenerates stale MOZAK.md files)");
    setIcon(btn, "refresh-cw");
    btn.addEventListener("click", () => { this.plugin.renderProjections(); this.refresh(); });

    if (this.error) {
      const box = el(root, "div", "mozak-empty");
      el(box, "div", "mozak-empty-title", "Cannot load MOZAK");
      el(box, "div", "mozak-muted", this.error);
      return;
    }
    const m = this.model;
    if (!m) return;
    this.renderFilter(root, m);
    const stale = countRemote(m.scopes).stale;
    if (m.totals.failed || stale) {
      el(root, "div", "mozak-warn",
        [m.totals.failed ? `${m.totals.failed} unreadable` : "", stale ? `${stale} remote stale` : ""].filter(Boolean).join(", "));
    }
    const visible = (this.filter === "all"
      ? [...m.scopes]
      : m.scopes.filter((s) => s.plans.some((p) => planMatches(p, this.filter))))
      .sort((a, b) => rank(a) - rank(b));
    if (visible.length === 0) {
      el(root, "div", "mozak-muted mozak-none", this.filter === "open" ? "No open plans. Nice." : "No completed plans yet.");
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
      pill.addEventListener("click", () => { this.filter = f.id; this.render(); });
    }
  }

  private renderScope(parent: HTMLElement, scope: ScopeVM): void {
    // A filter only shows scopes with matching plans, so open them to show those plans directly.
    const filtered = this.filter !== "all";
    const open = filtered ? !this.collapsed.has(scope.id) : this.expanded.has(scope.id);
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
      md.setAttr("aria-label", "Open MOZAK.md");
      md.addEventListener("click", (ev) => { ev.stopPropagation(); void this.plugin.openMozakMd(scope); });
    }
    row.addEventListener("click", () => {
      const set = filtered ? this.collapsed : this.expanded;
      const add = filtered ? open : !open;
      if (add) set.add(scope.id); else set.delete(scope.id);
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
    for (const plan of scope.plans.filter((p) => planMatches(p, this.filter))) {
      const p = el(body, "div", `mozak-plan-row row-${plan.state}`);
      p.setAttr("title", `${plan.stateLabel}: ${plan.title}${plan.strip ? `\n${plan.strip.done}/${plan.strip.total} outcomes done` : ""}\nOpen in MOZAK.md`);
      el(p, "span", `mozak-dot dot-${plan.state}`);
      el(p, "span", "mozak-plan-title", plan.title);
      if (plan.state === "awaiting" || plan.state === "paused" || plan.state === "rejected") {
        el(p, "span", `mozak-mini state-${plan.state}`, plan.stateLabel);
      } else if (plan.state === "open" && plan.strip) {
        renderStrip(p, plan.strip);
      }
      p.addEventListener("click", () => void this.plugin.openPlan(scope, plan));
    }
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
