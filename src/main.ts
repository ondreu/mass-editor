import { Plugin } from "obsidian";
import {
  DEFAULT_COLUMNS,
  DEFAULT_SETTINGS,
  type MassEditSettings,
  MassEditSettingTab,
} from "./settings";
import { MassEditView, VIEW_TYPE_MASS_EDIT } from "./view/MassEditView";
import { BackupManager } from "./backup/backupManager";

export default class MassEditorPlugin extends Plugin {
  settings!: MassEditSettings;
  backup!: BackupManager;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.backup = new BackupManager(
      this.app,
      this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`,
      () => ({
        backupFolder: this.settings.backupFolder,
        retention: this.settings.backupRetention,
      }),
      this.settings.history,
      () => this.saveSettings()
    );

    this.registerView(
      VIEW_TYPE_MASS_EDIT,
      (leaf) => new MassEditView(leaf, this)
    );

    this.addRibbonIcon("replace", "Mass Editor: open", () =>
      this.activateView()
    );

    this.addCommand({
      id: "open",
      name: "Open",
      callback: () => {
        void this.activateView();
      },
    });

    this.addSettingTab(new MassEditSettingTab(this.app, this));
  }

  /** Opens the view in a main leaf (not the sidebar). */
  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_MASS_EDIT);
    if (existing.length > 0) {
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_MASS_EDIT, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    const data = ((await this.loadData()) ?? {}) as Partial<MassEditSettings>;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    // history and presets must be arrays
    if (!Array.isArray(this.settings.history)) this.settings.history = [];
    if (!Array.isArray(this.settings.presets)) this.settings.presets = [];
    if (
      !Array.isArray(this.settings.resultColumns) ||
      this.settings.resultColumns.length === 0
    )
      this.settings.resultColumns = DEFAULT_COLUMNS.map((c) => ({ ...c }));
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
