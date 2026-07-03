import { type App, PluginSettingTab, Setting } from "obsidian";
import type MassEditorPlugin from "./main";
import type { RunRecord } from "./backup/backupManager";
import type { RegexScope } from "./edit/applier";
import type { EditOp } from "./edit/operations";
import type { Group } from "./query/types";

/** A saved query + operations template. */
export interface Preset {
  id: string;
  name: string;
  query: Group;
  ops: EditOp[];
}

/** What a results column displays. */
export type ColumnType =
  | "name"
  | "path"
  | "frontmatter"
  | "tags"
  | "created"
  | "modified";

/** A column in the results table. */
export interface ResultColumn {
  id: string;
  type: ColumnType;
  /** Frontmatter key (only when `type === "frontmatter"`). */
  key?: string;
}

/** Default results columns: note name + folder (both removable). */
export const DEFAULT_COLUMNS: ResultColumn[] = [
  { id: "col-name", type: "name" },
  { id: "col-path", type: "path" },
];

export interface MassEditSettings {
  backupFolder: string;
  backupRetention: number;
  confirmBeforeApply: boolean;
  defaultSelectAll: boolean;
  regexScope: RegexScope;
  liveCountDebounceMs: number;
  /** Side-by-side layout as the default for diff views. */
  diffSplitView: boolean;
  /** Vault folder for exported run reports. */
  reportFolder: string;
  /** Saved query + operation templates. */
  presets: Preset[];
  /** Columns shown in the results table. */
  resultColumns: ResultColumn[];
  /** Run history for undo. */
  history: RunRecord[];
}

export const DEFAULT_SETTINGS: MassEditSettings = {
  backupFolder: "",
  backupRetention: 20,
  confirmBeforeApply: true,
  defaultSelectAll: true,
  regexScope: "body",
  liveCountDebounceMs: 200,
  diffSplitView: false,
  reportFolder: "Mass Editor Reports",
  presets: [],
  resultColumns: DEFAULT_COLUMNS.map((c) => ({ ...c })),
  history: [],
};

export class MassEditSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: MassEditorPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Backup folder")
      .setDesc(
        "Where to store backups. Empty = the plugin folder (may not sync, and reinstalling the plugin can delete it). For durable backups, choose a path inside your vault."
      )
      .addText((t) =>
        t
          .setPlaceholder(
            `${this.app.vault.configDir}/plugins/mass-editor/backups`
          )
          .setValue(this.plugin.settings.backupFolder)
          .onChange(async (v) => {
            this.plugin.settings.backupFolder = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Backup retention")
      .setDesc("Number of runs to keep; older runs are pruned automatically.")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.backupRetention))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            this.plugin.settings.backupRetention = Number.isNaN(n) ? 20 : n;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Confirm before apply")
      .setDesc("Show a confirmation dialog before bulk editing.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.confirmBeforeApply)
          .onChange(async (v) => {
            this.plugin.settings.confirmBeforeApply = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Select all results by default")
      .setDesc("New search results start fully selected.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.defaultSelectAll).onChange(async (v) => {
          this.plugin.settings.defaultSelectAll = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Regex scope")
      .setDesc(
        "Body = only content after the frontmatter (safe). Whole file may corrupt YAML."
      )
      .addDropdown((d) =>
        d
          .addOption("body", "Body only")
          .addOption("whole", "Whole file (risky)")
          .setValue(this.plugin.settings.regexScope)
          .onChange(async (v) => {
            this.plugin.settings.regexScope = v as RegexScope;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Report folder")
      .setDesc("Vault folder where exported run reports (Markdown) are saved.")
      .addText((t) =>
        t
          .setPlaceholder("Mass Editor Reports")
          .setValue(this.plugin.settings.reportFolder)
          .onChange(async (v) => {
            this.plugin.settings.reportFolder = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Side-by-side diff by default")
      .setDesc("Show the diff view in a two-column layout instead of unified.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.diffSplitView).onChange(async (v) => {
          this.plugin.settings.diffSplitView = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Live count debounce (ms)")
      .setDesc("Delay before recomputing the note count after a query change.")
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.liveCountDebounceMs))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            this.plugin.settings.liveCountDebounceMs = Number.isNaN(n) ? 200 : n;
            await this.plugin.saveSettings();
          })
      );
  }
}
