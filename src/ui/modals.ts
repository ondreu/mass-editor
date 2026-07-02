import { type App, Modal, Setting } from "obsidian";
import type { ImpactSummary } from "../edit/summary";
import type {
  BackupManager,
  RunRecord,
  UndoPlan,
} from "../backup/backupManager";
import { noteCount } from "./dom";

/** Potvrzovací dialog se souhrnem dopadu. */
export class ConfirmApplyModal extends Modal {
  constructor(
    app: App,
    private summary: ImpactSummary,
    private onConfirm: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("me-modal");
    contentEl.createEl("h3", { text: "Potvrdit hromadnou editaci" });
    contentEl.createEl("p", {
      cls: "me-modal__lead",
      text: `Dotčeno ${noteCount(this.summary.fileCount)}. Před zápisem se vytvoří záloha.`,
    });

    const list = contentEl.createDiv({ cls: "me-summary" });
    this.summary.lines.forEach((line) => {
      const row = list.createDiv({
        cls: "me-summary__line" + (line.tone === "warn" ? " is-warn" : ""),
      });
      row.setText(line.text);
    });

    const buttons = contentEl.createDiv({ cls: "me-modal__actions" });
    const cancel = buttons.createEl("button", { text: "Zrušit" });
    cancel.onclick = () => this.close();
    const apply = buttons.createEl("button", {
      cls: "me-btn me-btn--primary",
      text: "Aplikovat",
    });
    apply.onclick = () => {
      this.close();
      this.onConfirm();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Historie běhů + undo. */
export class HistoryModal extends Modal {
  constructor(
    app: App,
    private backup: BackupManager,
    private onAfterUndo: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("me-modal");
    contentEl.createEl("h3", { text: "Historie běhů" });

    const runs = this.backup.getHistory();
    if (runs.length === 0) {
      contentEl.createDiv({
        cls: "me-empty",
        text: "Zatím žádný běh editace.",
      });
      return;
    }

    const list = contentEl.createDiv({ cls: "me-history" });
    runs.forEach((rec) => this.renderRun(list, rec));
  }

  private renderRun(list: HTMLElement, rec: RunRecord): void {
    const row = list.createDiv({ cls: "me-history__row" });
    if (rec.undone) row.addClass("is-undone");

    const info = row.createDiv({ cls: "me-history__info" });
    info.createDiv({
      cls: "me-history__time",
      text: new Date(rec.timestamp).toLocaleString(),
    });
    info.createDiv({
      cls: "me-history__meta",
      text: `${noteCount(rec.fileCount)} • ${rec.opCount} operací${
        rec.undone ? " • vráceno" : ""
      }`,
    });

    const undo = row.createEl("button", {
      cls: "me-btn me-btn--danger",
      text: rec.undone ? "Vráceno" : "Vrátit zpět",
    });
    undo.disabled = !!rec.undone;
    undo.onclick = async () => {
      const plan = await this.backup.planUndo(rec);
      if (!plan) {
        row.createDiv({ cls: "me-op__err is-visible", text: "Záloha nenalezena." });
        return;
      }
      const drifted = plan.entries.filter((e) => e.drifted).length;
      if (drifted > 0) {
        new UndoDriftModal(this.app, plan, async (overwrite) => {
          await this.doUndo(rec, overwrite);
        }).open();
      } else {
        await this.doUndo(rec, false);
      }
    };
  }

  private async doUndo(rec: RunRecord, overwrite: boolean): Promise<void> {
    const res = await this.backup.undoRun(rec, overwrite);
    this.onAfterUndo();
    new ResultModal(
      this.app,
      "Undo dokončeno",
      [
        `Obnoveno: ${res.restored}`,
        `Přeskočeno: ${res.skipped}`,
        ...res.errors.map((e) => `Chyba: ${e}`),
      ]
    ).open();
    this.render();
  }
}

/** Volba při driftu — přeskočit vs přepsat změněné soubory. */
export class UndoDriftModal extends Modal {
  constructor(
    app: App,
    private plan: UndoPlan,
    private onChoose: (overwrite: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("me-modal");
    contentEl.createEl("h3", { text: "Některé soubory byly změněny" });
    const drifted = this.plan.entries.filter((e) => e.drifted);
    contentEl.createEl("p", {
      cls: "me-modal__lead",
      text: `${drifted.length} souborů bylo od editace ručně změněno. Obnovení je přepíše.`,
    });

    const list = contentEl.createDiv({ cls: "me-summary" });
    drifted.slice(0, 30).forEach((e) => {
      list.createDiv({ cls: "me-summary__line is-warn", text: e.path });
    });
    if (drifted.length > 30) {
      list.createDiv({ cls: "me-summary__line", text: `… a další (${drifted.length - 30})` });
    }

    const actions = contentEl.createDiv({ cls: "me-modal__actions" });
    const skip = actions.createEl("button", {
      text: "Přeskočit změněné",
    });
    skip.onclick = () => {
      this.close();
      this.onChoose(false);
    };
    const overwrite = actions.createEl("button", {
      cls: "me-btn me-btn--danger",
      text: "Přepsat vše",
    });
    overwrite.onclick = () => {
      this.close();
      this.onChoose(true);
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Jednoduchý výsledkový dialog (report). */
export class ResultModal extends Modal {
  constructor(app: App, private title: string, private lines: string[]) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("me-modal");
    contentEl.createEl("h3", { text: this.title });
    const list = contentEl.createDiv({ cls: "me-summary" });
    this.lines.forEach((l) =>
      list.createDiv({
        cls: "me-summary__line" + (l.startsWith("Chyba") ? " is-warn" : ""),
        text: l,
      })
    );
    new Setting(contentEl).addButton((b) =>
      b.setButtonText("Zavřít").setCta().onClick(() => this.close())
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
