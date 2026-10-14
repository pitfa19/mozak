import { FileSystemAdapter, Notice, Plugin, PluginSettingTab, Setting, TFile, type App, type WorkspaceLeaf } from "obsidian";
import { chooseInventory } from "./discover.ts";
import { resolveOpenTarget, type PlanVM, type ScopeVM } from "./model.ts";
import { PlanView, PLAN_VIEW_TYPE, ScopesView, SCOPES_VIEW_TYPE } from "./views.ts";

export interface MozakSettings { inventoryPath: string }
const DEFAULTS: MozakSettings = { inventoryPath: "" };

export default class MozakPlugin extends Plugin {
  settings: MozakSettings = { ...DEFAULTS };

  async onload(): Promise<void> {
    this.settings = { ...DEFAULTS, ...(await this.loadData()) };
    this.registerView(SCOPES_VIEW_TYPE, (leaf) => new ScopesView(leaf, this));
    this.registerView(PLAN_VIEW_TYPE, (leaf) => new PlanView(leaf, this));
    this.addRibbonIcon("brain-circuit", "MOZAK: open scopes", () => void this.activateScopes());
    this.addCommand({ id: "open-scopes", name: "MOZAK: open scopes", callback: () => void this.activateScopes() });
    this.addSettingTab(new MozakSettingTab(this.app, this));
  }

  vaultBase(): string | null {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
  }

  inventory() { return chooseInventory(this.settings.inventoryPath, this.vaultBase()); }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.app.workspace.getLeavesOfType(SCOPES_VIEW_TYPE).forEach((l) => (l.view as ScopesView).refresh());
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

  async openPlan(scope: ScopeVM, plan: PlanVM): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: PLAN_VIEW_TYPE, active: true, state: { scope, plan } });
    await this.app.workspace.revealLeaf(leaf);
  }

  /** Open the scope's MOZAK.md: in Obsidian when inside this vault, otherwise with the OS default app. */
  async openMozakMd(scope: ScopeVM): Promise<void> {
    return this.openScopeFile(scope, "MOZAK.md");
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
    if (err) new Notice(`MOZAK: could not open ${file}: ${err}`);
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
  }
}
