import { FileSystemAdapter, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, type App, type WorkspaceLeaf } from "obsidian";
import { readFileSync } from "node:fs";
import { BRIDGE_FILE } from "@mozak/core";
import { chooseInventory } from "./discover.ts";
import { renderStaleProjections, syncRemoteScopes } from "./load.ts";
import { startWatching, watchTargets } from "./watch.ts";
import { headingLine, resolveOpenTarget, type PlanVM, type ScopeVM } from "./model.ts";
import { LEGACY_PLAN_VIEW_TYPE, ScopesView, SCOPES_VIEW_TYPE } from "./views.ts";

export interface MozakSettings {
  inventoryPath: string;
  /** Refresh automatically when a plan file changes. */
  autoRefresh: boolean;
  /** Seconds between automatic syncs of remote (repo) scopes. 0 turns polling off. */
  remotePollSeconds: number;
}
const DEFAULTS: MozakSettings = { inventoryPath: "", autoRefresh: true, remotePollSeconds: 60 };

export default class MozakPlugin extends Plugin {
  settings: MozakSettings = { ...DEFAULTS };
  private stopWatch: (() => void) | null = null;
  private pollTimer: number | null = null;

  async onload(): Promise<void> {
    this.settings = { ...DEFAULTS, ...(await this.loadData()) };
    this.registerView(SCOPES_VIEW_TYPE, (leaf) => new ScopesView(leaf, this));
    this.addRibbonIcon("brain-circuit", "Open mozak scopes", () => void this.activateScopes());
    this.addCommand({ id: "open-scopes", name: "Open scopes", callback: () => void this.activateScopes() });
    this.addSettingTab(new MozakSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => {
      // The plan detail tab is retired: plans are read in mozak.md. Close tabs restored from older versions.
      this.app.workspace.getLeavesOfType(LEGACY_PLAN_VIEW_TYPE).forEach((l) => l.detach());
      this.restartAutoRefresh();
    });
  }

  onunload(): void { this.stopAutoRefresh(); }

  private stopAutoRefresh(): void {
    this.stopWatch?.();
    this.stopWatch = null;
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /** (Re)start file watching for local scopes and repo polling for remote scopes, per settings. */
  restartAutoRefresh(): void {
    this.stopAutoRefresh();
    if (!this.settings.autoRefresh) return;
    const path = this.inventory().path;
    if (!path) return;
    this.startFileWatch(path);
    const secs = Math.max(0, Math.floor(this.settings.remotePollSeconds));
    if (secs > 0) {
      this.pollTimer = window.setInterval(() => this.pollRemotes(path), Math.max(15, secs) * 1000);
    }
  }

  /** Watch files for the current inventory. After every change the targets are rebuilt, so scopes added to the inventory get watched too. */
  private startFileWatch(path: string): void {
    this.stopWatch?.();
    this.stopWatch = startWatching(watchTargets(path), () => {
      this.refreshAll();
      if (this.settings.autoRefresh) this.startFileWatch(path);
    });
  }

  /** Pull remote (repo) scopes. A changed cache is picked up by the file watcher. Quiet unless it fails. */
  private pollRemotes(path: string): void {
    try { syncRemoteScopes(path); } catch { /* offline or unreadable: keep the cached copy */ }
  }

  /** Reload every open mozak view from disk. */
  refreshAll(): void {
    this.app.workspace.getLeavesOfType(SCOPES_VIEW_TYPE).forEach((l) => (l.view as ScopesView).refresh());
  }

  /**
   * Regenerate stale mozak.md projections of local scopes through core (the same code as `mozak render`).
   * Never writes mozak.json; conflicting hand edits are left alone. Quiet unless something fails.
   */
  renderProjections(): void {
    const path = this.inventory().path;
    if (!path) return;
    try {
      const r = renderStaleProjections(path);
      if (!r.ok) new Notice(`mozak: ${r.message}`, 8000);
    } catch { /* unreadable inventory is reported by the view itself */ }
  }

  vaultBase(): string | null {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
  }

  inventory() { return chooseInventory(this.settings.inventoryPath, this.vaultBase()); }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.refreshAll();
    this.restartAutoRefresh();
  }

  async activateScopes(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(SCOPES_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: SCOPES_VIEW_TYPE, active: true });
    }
    if (leaf) await workspace.revealLeaf(leaf);
  }

  /** Open the scope's mozak.md scrolled to this plan's heading. Plans are read there, not in a plugin pane. */
  async openPlan(scope: ScopeVM, plan: PlanVM): Promise<void> {
    if (plan.state === "rejected") {
      new Notice("mozak: rejected plans are not shown in mozak.md. Their record remains in mozak.json.", 6000);
      return;
    }
    const file = `${scope.root}/${scope.bridgeFile ?? BRIDGE_FILE}`;
    const target = resolveOpenTarget(this.vaultBase() ?? "", file);
    if (target.kind === "vault") {
      const abstract = this.app.vault.getAbstractFileByPath(target.path);
      if (abstract instanceof TFile) {
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(abstract);
        const line = headingLine(await this.app.vault.cachedRead(abstract), plan.heading);
        const view = leaf.view;
        if (line !== null && view instanceof MarkdownView) {
          view.setEphemeralState({ line });
          if (view.getMode() === "source") view.editor.setCursor({ line, ch: 0 });
        } else if (line === null) {
          new Notice("mozak: this plan is missing from the projection. Run `mozak render` or refresh.", 6000);
        }
        return;
      }
    }
    // Outside the vault (remote cache, other folders): open the file itself. External apps cannot jump to a heading.
    let found = false;
    try { found = headingLine(readFileSync(file, "utf8"), plan.heading) !== null; } catch { /* reported below */ }
    const err = await this.openExternal(file);
    if (err) new Notice(`mozak: could not open ${file}: ${err}`);
    else if (!found) new Notice("mozak: this mozak.md is not rendered with plan sections yet. Run `mozak render` or refresh.", 6000);
  }

  /** Open the scope's mozak.md: in Obsidian when inside this vault, otherwise with the OS default app. */
  async openMozakMd(scope: ScopeVM): Promise<void> {
    return this.openScopeFile(scope, scope.bridgeFile ?? BRIDGE_FILE);
  }

  /** Open a file at the scope root: in Obsidian when inside this vault, otherwise with the OS default app. */
  async openScopeFile(scope: ScopeVM, name: string): Promise<void> {
    const file = `${scope.root}/${name}`;
    const target = resolveOpenTarget(this.vaultBase() ?? "", file);
    if (target.kind === "vault") {
      const abstract = this.app.vault.getAbstractFileByPath(target.path);
      if (abstract instanceof TFile) {
        await this.app.workspace.getLeaf("tab").openFile(abstract);
        return;
      }
    }
    const err = await this.openExternal(file);
    if (err) new Notice(`mozak: could not open ${file}: ${err}`);
  }

  private async openExternal(path: string): Promise<string> {
    // Desktop-only plugin, so Electron's shell is available.
    const { shell } = require("electron") as { shell: { openPath(p: string): Promise<string> } };
    return shell.openPath(path);
  }
}

class MozakSettingTab extends PluginSettingTab {
  private plugin: MozakPlugin;
  constructor(app: App, plugin: MozakPlugin) { super(app, plugin); this.plugin = plugin; }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const resolved = this.plugin.inventory();
    new Setting(containerEl)
      .setName("Inventory path")
      .setDesc(`Path to mozak-inventory.json. Leave empty to search upward from the vault folder. Currently: ${resolved.path ?? "not found"} (${resolved.source}).`)
      .addText((t) =>
        t.setPlaceholder("auto-discover").setValue(this.plugin.settings.inventoryPath).onChange(async (v) => {
          this.plugin.settings.inventoryPath = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl)
      .setName("Auto-refresh")
      .setDesc("Reload mozak views as soon as a plan changes on disk.")
      .addToggle((t) => t.setValue(this.plugin.settings.autoRefresh).onChange(async (v) => {
        this.plugin.settings.autoRefresh = v;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("Repo sync interval (seconds)")
      .setDesc("How often remote (repo) scopes are pulled so repo plan changes appear automatically. 0 turns it off. Minimum 15.")
      .addText((t) => t.setValue(String(this.plugin.settings.remotePollSeconds)).onChange(async (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) return;
        this.plugin.settings.remotePollSeconds = n;
        await this.plugin.saveSettings();
      }));
  }
}
