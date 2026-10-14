import { ItemView, Notice, setIcon, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { countRemote, countsSummary, planMatches, scopesModel, type ContentVM, type PlanFilter, type PlanVM, type ScopeVM, type ScopesModel } from "./model.ts";
import { loadScopesModel, describeError, syncRemoteScopes } from "./load.ts";
import type MozakPlugin from "./main.ts";

export const SCOPES_VIEW_TYPE = "mozak-scopes";
export const PLAN_VIEW_TYPE = "mozak-plan";

function el(parent: HTMLElement, tag: string, cls?: string, text?: string): HTMLElement {
  const e = parent.createEl(tag as keyof HTMLElementTagNameMap, { cls });
  if (text !== undefined) e.setText(text);
  return e;
}

const FILTERS: { id: PlanFilter; label: string; icon: string }[] = [
  { id: "all", label: "All", icon: "layers" },
  { id: "open", label: "Open", icon: "circle-dot" },
  { id: "completed", label: "Completed", icon: "check-circle-2" },
];

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
    button.setText("Syncing...");
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
    el(head, "span", "mozak-title", "MOZAK scopes");
    const btn = el(head, "button", "clickable-icon mozak-refresh");
    btn.setAttr("aria-label", "Refresh");
    setIcon(btn, "refresh-cw");
    btn.addEventListener("click", () => this.refresh());
    if (this.model && countRemote(this.model.scopes).remote > 0) {
      const sync = el(head, "button", "mozak-sync", "Sync remote scopes");
      sync.setAttr("aria-label", "Sync remote scopes");
      sync.addEventListener("click", () => this.syncRemote(sync));
    }

    if (this.error) {
      const box = el(root, "div", "mozak-empty");
      el(box, "div", "mozak-empty-title", "Cannot load MOZAK");
      el(box, "div", "mozak-muted", this.error);
      return;
    }
    const m = this.model;
    if (!m) return;
    this.renderFilter(root, m);
    el(root, "div", "mozak-muted mozak-summary",
      `${m.totals.scopes} scopes, ${countsSummary(m.totals)}${m.totals.failed ? `, ${m.totals.failed} unreadable` : ""}${countRemote(m.scopes).stale ? `, ${countRemote(m.scopes).stale} remote stale` : ""}`);
    const visible = this.filter === "all"
      ? m.scopes
      : m.scopes.filter((s) => s.plans.some((p) => planMatches(p, this.filter)));
    if (visible.length === 0) {
      const box = el(root, "div", "mozak-empty");
      el(box, "div", "mozak-muted", this.filter === "open" ? "No open plans. Nice." : "No completed plans yet.");
      return;
    }
    for (const scope of visible) this.renderScope(root, scope);
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
      setIcon(el(pill, "span", "mozak-pill-icon"), f.icon);
      el(pill, "span", "mozak-pill-label", f.label);
      el(pill, "span", "mozak-pill-count", String(n));
      pill.addEventListener("click", () => { this.filter = f.id; this.render(); });
    }
  }

  private renderScope(parent: HTMLElement, scope: ScopeVM): void {
    // A filter only shows scopes with matching plans, so open them to show those plans directly.
    const filtered = this.filter !== "all";
    const open = filtered ? !this.collapsed.has(scope.id) : this.expanded.has(scope.id);
    const box = el(parent, "div", "mozak-scope" + (scope.status === "failed" ? " is-failed" : ""));
    const row = el(box, "div", "mozak-scope-row");
    const chev = el(row, "span", "mozak-chevron");
    setIcon(chev, open ? "chevron-down" : "chevron-right");
    const main = el(row, "div", "mozak-scope-main");
    const top = el(main, "div", "mozak-scope-top");
    el(top, "span", "mozak-scope-title", scope.title);
    el(top, "span", "mozak-kind", scope.kind);
    if (scope.remote) {
      el(top, "span", "mozak-badge mozak-remote", "remote");
      if (scope.remote.stale) {
        const s = el(top, "span", "mozak-badge mozak-stale", "stale");
        s.setAttr("title", `Cached copy. ${scope.remote.staleReason ?? ""}${scope.remote.lastFetchAt ? ` Last fetch ${scope.remote.lastFetchAt}.` : ""}`.trim());
      }
    }
    if (scope.status === "failed") {
      el(main, "div", "mozak-error", `${scope.errorCode}: ${scope.errorMessage}`);
    } else {
      el(main, "div", "mozak-muted", `${scope.counts.completed} completed, ${scope.counts.open} open, ${scope.counts.awaiting} awaiting`);
    }
    row.addEventListener("click", () => {
      const set = filtered ? this.collapsed : this.expanded;
      const add = filtered ? open : !open;
      if (add) set.add(scope.id); else set.delete(scope.id);
      this.render();
    });
    if (!open) return;
    const body = el(box, "div", "mozak-plans");
    if (scope.status === "ok" && scope.plans.length === 0) el(body, "div", "mozak-muted mozak-noplans", "No plans yet.");
    for (const plan of scope.plans.filter((p) => planMatches(p, this.filter))) {
      const p = el(body, "div", `mozak-plan-row row-${plan.state}`);
      el(p, "span", `mozak-badge state-${plan.state}`, plan.stateLabel);
      el(p, "span", "mozak-plan-title", plan.title);
      p.addEventListener("click", () => void this.plugin.openPlan(scope, plan));
    }
    const actions = el(body, "div", "mozak-scope-actions");
    el(actions, "span", "mozak-muted mozak-path", scope.root);
    if (scope.hasMozakMd) {
      const b = el(actions, "button", "mozak-link", "Open MOZAK.md");
      b.addEventListener("click", () => void this.plugin.openMozakMd(scope));
    }
  }
}

interface PlanViewState { scope: ScopeVM; plan: PlanVM }

export class PlanView extends ItemView {
  private data: PlanViewState | null = null;
  private plugin: MozakPlugin;
  constructor(leaf: WorkspaceLeaf, plugin: MozakPlugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return PLAN_VIEW_TYPE; }
  getDisplayText() { return this.data?.plan.title ?? "MOZAK plan"; }
  getIcon() { return "list-checks"; }

  getState(): Record<string, unknown> { return this.data ? { ...this.data } : {}; }
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = state as Partial<PlanViewState> | null;
    if (s?.scope && s.plan) this.data = { scope: s.scope, plan: s.plan };
    this.render();
    await super.setState(state, result);
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("mozak-root", "mozak-detail");
    if (!this.data) { el(root, "div", "mozak-muted", "No plan selected."); return; }
    const { scope, plan } = this.data;
    el(root, "div", "mozak-muted", `${scope.title} / ${plan.id}`);
    el(root, "h1", "mozak-h1", plan.title);
    const meta = el(root, "div", "mozak-meta");
    el(meta, "span", `mozak-badge state-${plan.state}`, plan.stateLabel);
    for (const f of plan.flags) el(meta, "span", "mozak-badge state-flag", f);
    el(meta, "span", "mozak-muted", `updated ${plan.updatedAt}`);
    if (plan.completedAt) el(meta, "span", "mozak-muted", `completed ${plan.completedAt}`);
    if (scope.hasMozakMd) {
      const b = el(meta, "button", "mozak-link", "Open MOZAK.md");
      b.addEventListener("click", () => void this.plugin.openMozakMd(scope));
    }
    if (plan.reason) section(root, "Reason", (s) => el(s, "p", undefined, plan.reason!));
    renderContent(root, plan.content);
    if (plan.pendingRevision) {
      const h = el(root, "h2", "mozak-h2", "Pending revision (awaiting approval)");
      h.addClass("mozak-pending");
      renderContent(root, plan.pendingRevision);
    }
    if (plan.limitations.length) section(root, "Completion limitations", (s) => list(s, plan.limitations));
    if (plan.observations.length) {
      section(root, "Observations", (s) => {
        for (const o of plan.observations) {
          const d = el(s, "div", "mozak-obs");
          el(d, "span", "mozak-badge state-flag", o.classification);
          el(d, "span", undefined, o.summary);
        }
      });
    }
  }
}

function section(parent: HTMLElement, title: string, fill: (s: HTMLElement) => void): void {
  const s = el(parent, "section", "mozak-section");
  el(s, "h2", "mozak-h2", title);
  fill(s);
}

function list(parent: HTMLElement, items: string[]): void {
  const ul = el(parent, "ul", "mozak-list");
  for (const i of items) el(ul, "li", undefined, i);
}

function renderContent(root: HTMLElement, c: ContentVM): void {
  if (c.purpose) section(root, "Purpose", (s) => el(s, "p", undefined, c.purpose));
  if (c.outcomes.length) {
    section(root, "Outcomes", (s) => {
      for (const o of c.outcomes) {
        const d = el(s, "div", "mozak-outcome");
        const t = el(d, "div", "mozak-outcome-title");
        el(t, "span", undefined, o.statement);
        el(t, "span", "mozak-badge state-flag", o.acceptance);
        if (o.criterion) el(d, "div", "mozak-muted", `Criterion: ${o.criterion}`);
      }
    });
  }
  if (c.constraints.length) section(root, "Constraints", (s) => list(s, c.constraints));
  if (c.nonGoals.length) section(root, "Non-goals", (s) => list(s, c.nonGoals));
  if (c.rationale) section(root, "Rationale", (s) => el(s, "p", undefined, c.rationale));
  if (c.questions.length) section(root, "Open questions", (s) => list(s, c.questions));
  if (c.sources.length) {
    section(root, "Sources", (s) =>
      list(s, c.sources.map((x) => [x.locator, x.anchor, x.version].filter(Boolean).join(" | "))));
  }
}

export { scopesModel };
