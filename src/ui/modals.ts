import { type App, Modal, setIcon } from "obsidian";
import type { ImpactSummary } from "../edit/summary";
import type {
  BackupManager,
  RunRecord,
  UndoPlan,
} from "../backup/backupManager";
import { noteCount } from "./dom";

/** Confirmation dialog showing the impact summary. */
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
    contentEl.createEl("h3", { text: "Apply changes" });
    contentEl.createEl("p", {
      text: `${noteCount(this.summary.fileCount)} affected. A backup is created before writing.`,
    });

    const list = contentEl.createDiv({ cls: "me-summary" });
    this.summary.lines.forEach((line) => {
      const row = list.createDiv({
        cls: "me-summary__line" + (line.tone === "warn" ? " is-warn" : ""),
      });
      row.setText(line.text);
    });

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();
    const apply = buttons.createEl("button", {
      cls: "mod-cta",
      text: "Apply",
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

/** Run history + undo. */
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
    contentEl.createEl("h3", { text: "History" });

    const runs = this.backup.getHistory();
    if (runs.length === 0) {
      contentEl.createDiv({ cls: "me-empty", text: "No edit runs yet." });
      return;
    }

    const list = contentEl.createDiv({ cls: "me-history" });
    runs.forEach((rec) => this.renderRun(list, rec));
  }

  private renderRun(list: HTMLElement, rec: RunRecord): void {
    const wrap = list.createDiv({ cls: "me-history__item" });
    const row = wrap.createDiv({ cls: "me-history__row" });
    if (rec.undone) row.addClass("is-undone");

    const expand = row.createDiv({ cls: "clickable-icon" });
    setIcon(expand, "chevron-right");

    const info = row.createDiv({ cls: "me-history__info" });
    info.createDiv({ text: new Date(rec.timestamp).toLocaleString() });
    info.createDiv({
      cls: "me-history__meta",
      text: `${noteCount(rec.fileCount)} · ${rec.opCount} operations${
        rec.undone ? " · reverted" : ""
      }`,
    });

    const undo = row.createEl("button", {
      cls: "mod-warning",
      text: rec.undone ? "Reverted" : "Undo all",
    });
    undo.disabled = !!rec.undone;
    undo.onclick = () => void this.doUndo(rec);

    // Expandable per-file panel for partial undo.
    const panel = wrap.createDiv({ cls: "me-history__files" });
    panel.hide();
    let loaded = false;
    expand.onclick = async () => {
      const open = panel.isShown();
      if (open) {
        panel.hide();
        setIcon(expand, "chevron-right");
        return;
      }
      panel.show();
      setIcon(expand, "chevron-down");
      if (!loaded) {
        loaded = true;
        await this.renderFilePanel(panel, rec);
      }
    };
  }

  private async renderFilePanel(
    panel: HTMLElement,
    rec: RunRecord
  ): Promise<void> {
    panel.empty();
    const plan = await this.backup.planUndo(rec);
    if (!plan) {
      panel.createDiv({ cls: "me-op__error", text: "Backup not found." });
      return;
    }
    const chosen = new Set<string>(plan.entries.map((e) => e.path));
    for (const entry of plan.entries) {
      const r = panel.createEl("label", { cls: "me-history__file" });
      const cb = r.createEl("input", { attr: { type: "checkbox" } });
      cb.checked = true;
      cb.onchange = () => {
        if (cb.checked) chosen.add(entry.path);
        else chosen.delete(entry.path);
      };
      r.createSpan({ cls: "me-history__file-path", text: entry.path });
      if (entry.drifted)
        r.createSpan({ cls: "me-history__drift", text: "changed" });
    }
    const actions = panel.createDiv({ cls: "me-history__file-actions" });
    const btn = actions.createEl("button", {
      cls: "mod-warning",
      text: "Undo selected",
    });
    btn.onclick = () => {
      if (chosen.size === 0) return;
      void this.doUndo(rec, new Set(chosen));
    };
  }

  private async doUndo(rec: RunRecord, paths?: Set<string>): Promise<void> {
    const plan = await this.backup.planUndo(rec);
    if (!plan) {
      new ResultModal(this.app, "Undo", ["Error: backup not found."]).open();
      return;
    }
    const relevant = paths
      ? plan.entries.filter((e) => paths.has(e.path))
      : plan.entries;
    const drifted = relevant.filter((e) => e.drifted).length;
    if (drifted > 0) {
      new UndoDriftModal(
        this.app,
        { runId: plan.runId, entries: relevant },
        (overwrite) => void this.runUndo(rec, overwrite, paths)
      ).open();
    } else {
      await this.runUndo(rec, false, paths);
    }
  }

  private async runUndo(
    rec: RunRecord,
    overwrite: boolean,
    paths?: Set<string>
  ): Promise<void> {
    const res = await this.backup.undoRun(rec, overwrite, paths);
    this.onAfterUndo();
    new ResultModal(this.app, "Undo complete", [
      `Restored: ${res.restored}`,
      `Skipped: ${res.skipped}`,
      ...res.errors.map((e) => `Error: ${e}`),
    ]).open();
    this.render();
  }
}

/** Drift choice — skip vs overwrite manually-changed files. */
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
    contentEl.createEl("h3", { text: "Some files have changed" });
    const drifted = this.plan.entries.filter((e) => e.drifted);
    contentEl.createEl("p", {
      text: `${drifted.length} file(s) were modified since the edit. Restoring overwrites them.`,
    });

    const list = contentEl.createDiv({ cls: "me-summary" });
    drifted.slice(0, 30).forEach((e) => {
      list.createDiv({ cls: "me-summary__line is-warn", text: e.path });
    });
    if (drifted.length > 30) {
      list.createDiv({
        cls: "me-summary__line",
        text: `… and ${drifted.length - 30} more`,
      });
    }

    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    const skip = actions.createEl("button", { text: "Skip changed" });
    skip.onclick = () => {
      this.close();
      this.onChoose(false);
    };
    const overwrite = actions.createEl("button", {
      cls: "mod-warning",
      text: "Overwrite all",
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

/** Simple result dialog (report). */
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
        cls: "me-summary__line" + (l.startsWith("Error") ? " is-warn" : ""),
        text: l,
      })
    );
    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    const close = actions.createEl("button", { cls: "mod-cta", text: "Close" });
    close.onclick = () => this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
