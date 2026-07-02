import { type App, PluginSettingTab, Setting } from "obsidian";
import type MassEditorPlugin from "./main";
import type { RunRecord } from "./backup/backupManager";
import type { RegexScope } from "./edit/applier";

export interface MassEditSettings {
  backupFolder: string;
  backupRetention: number;
  confirmBeforeApply: boolean;
  defaultSelectAll: boolean;
  regexScope: RegexScope;
  liveCountDebounceMs: number;
  /** Historie běhů pro undo. */
  history: RunRecord[];
}

export const DEFAULT_SETTINGS: MassEditSettings = {
  backupFolder: "",
  backupRetention: 20,
  confirmBeforeApply: true,
  defaultSelectAll: true,
  regexScope: "body",
  liveCountDebounceMs: 200,
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
      .setName("Složka záloh")
      .setDesc(
        "Kam ukládat zálohy. Prázdné = složka pluginu (nemusí se synchronizovat a reinstalace ji smaže). Pro trvalé zálohy zvolte cestu ve vaultu."
      )
      .addText((t) =>
        t
          .setPlaceholder(".obsidian/plugins/mass-editor/backups")
          .setValue(this.plugin.settings.backupFolder)
          .onChange(async (v) => {
            this.plugin.settings.backupFolder = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Retence záloh")
      .setDesc("Počet uchovaných běhů; starší se automaticky mažou.")
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
      .setName("Potvrdit před aplikací")
      .setDesc("Zobrazit potvrzovací dialog před hromadnou editací.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.confirmBeforeApply)
          .onChange(async (v) => {
            this.plugin.settings.confirmBeforeApply = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Výchozí výběr všech výsledků")
      .setDesc("Nové výsledky vyhledávání jsou defaultně zaškrtnuté.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.defaultSelectAll).onChange(async (v) => {
          this.plugin.settings.defaultSelectAll = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Rozsah regexu")
      .setDesc(
        "Tělo = jen obsah za frontmatterem (bezpečné). Celý soubor může poškodit YAML."
      )
      .addDropdown((d) =>
        d
          .addOption("body", "Jen tělo")
          .addOption("whole", "Celý soubor (riziko)")
          .setValue(this.plugin.settings.regexScope)
          .onChange(async (v) => {
            this.plugin.settings.regexScope = v as RegexScope;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Debounce živého počítadla (ms)")
      .setDesc("Prodleva přepočtu počtu poznámek po změně dotazu.")
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
