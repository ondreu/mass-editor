import {
  ItemView,
  Notice,
  Platform,
  type TFile,
  type WorkspaceLeaf,
  setIcon,
} from "obsidian";
import type MassEditorPlugin from "../main";
import type { Group } from "../query/types";
import { estimatePhase1, search } from "../query/engine";
import { type EditOp, isOpValid } from "../edit/operations";
import { applyToFile } from "../edit/applier";
import { buildSummary } from "../edit/summary";
import { hashString } from "../backup/backupManager";
import { QueryBuilder, newGroup } from "../ui/QueryBuilder";
import { ResultsList } from "../ui/ResultsList";
import { OperationsPanel } from "../ui/OperationsPanel";
import { ConfirmApplyModal, HistoryModal, ResultModal } from "../ui/modals";
import { noteCount } from "../ui/dom";

export const VIEW_TYPE_MASS_EDIT = "mass-editor-view";

export class MassEditView extends ItemView {
  private query: Group = newGroup("AND");
  private results: TFile[] = [];
  private selected = new Set<string>();
  private ops: EditOp[] = [];

  private builder!: QueryBuilder;
  private resultsList!: ResultsList;
  private opsPanel!: OperationsPanel;

  private countEl!: HTMLElement;
  private searchBtn!: HTMLButtonElement;
  private applyBtn!: HTMLButtonElement;
  private applyNote!: HTMLElement;
  private countTimer: number | null = null;
  private searchAbort: AbortController | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: MassEditorPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_MASS_EDIT;
  }

  getDisplayText(): string {
    return "Mass Editor";
  }

  getIcon(): string {
    return "replace";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("mass-editor");

    this.renderToolbar(root);

    if (Platform.isMobile) this.renderMobile(root);
    else this.renderDesktop(root);

    this.refreshApplyState();
    this.scheduleCount();
  }

  async onClose(): Promise<void> {
    this.searchAbort?.abort();
    this.contentEl.empty();
  }

  // ---------- layout ----------

  private renderToolbar(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "me-toolbar" });
    bar.createDiv({ cls: "me-toolbar__title", text: "Mass Editor" });
    this.countEl = bar.createDiv({ cls: "me-toolbar__count" });

    const hist = bar.createEl("div", { cls: "clickable-icon" });
    setIcon(hist, "history");
    hist.setAttribute("aria-label", "History & undo");
    hist.onclick = () =>
      new HistoryModal(this.app, this.plugin.backup, () =>
        this.refreshApplyState()
      ).open();

    this.searchBtn = bar.createEl("button", {
      cls: "mod-cta",
      text: "Search",
    });
    this.searchBtn.onclick = () => void this.runSearch();
  }

  private section(parent: HTMLElement, title: string): HTMLElement {
    const sec = parent.createDiv({ cls: "me-section" });
    const head = sec.createDiv({ cls: "me-section__head" });
    head.createDiv({ cls: "me-section__title", text: title });
    return sec.createDiv({ cls: "me-section__body" });
  }

  private renderDesktop(root: HTMLElement): void {
    this.mountBuilder(this.section(root, "Query"));
    this.mountResults(this.section(root, "Results"));
    this.mountOps(this.section(root, "Operations"));
    this.mountApplyBar(root);
  }

  private renderMobile(root: HTMLElement): void {
    const tabs = root.createDiv({ cls: "me-tabs" });
    const tab1 = tabs.createEl("button", {
      cls: "is-active",
      text: "Filter & results",
    });
    const tab2 = tabs.createEl("button", { text: "Edit" });

    const panel1 = root.createDiv({ cls: "me-panel is-active" });
    const panel2 = root.createDiv({ cls: "me-panel" });

    this.mountBuilder(this.section(panel1, "Query"));
    this.mountResults(this.section(panel1, "Results"));
    this.mountOps(this.section(panel2, "Operations"));
    this.mountApplyBar(panel2);

    const activate = (idx: number) => {
      tab1.toggleClass("is-active", idx === 0);
      tab2.toggleClass("is-active", idx === 1);
      panel1.toggleClass("is-active", idx === 0);
      panel2.toggleClass("is-active", idx === 1);
    };
    tab1.onclick = () => activate(0);
    tab2.onclick = () => activate(1);
  }

  // ---------- mounts ----------

  private mountBuilder(container: HTMLElement): void {
    this.builder = new QueryBuilder(
      this.query,
      () => this.scheduleCount(),
      () => this.scheduleCount()
    );
    this.builder.mount(container);
  }

  private mountResults(container: HTMLElement): void {
    this.resultsList = new ResultsList(this.selected, () =>
      this.refreshApplyState()
    );
    this.resultsList.mount(container);
  }

  private mountOps(container: HTMLElement): void {
    this.opsPanel = new OperationsPanel(this.ops, () => this.refreshApplyState());
    this.opsPanel.mount(container);
  }

  private mountApplyBar(parent: HTMLElement): void {
    const bar = parent.createDiv({ cls: "me-apply" });
    this.applyNote = bar.createDiv({ cls: "me-apply__note" });
    this.applyBtn = bar.createEl("button", { cls: "mod-cta", text: "Apply" });
    this.applyBtn.onclick = () => void this.startApply();
  }

  // ---------- live count ----------

  private scheduleCount(): void {
    if (this.countTimer !== null) window.clearTimeout(this.countTimer);
    this.countTimer = window.setTimeout(
      () => this.updateCount(),
      this.plugin.settings.liveCountDebounceMs
    );
  }

  private updateCount(): void {
    const { certain, maybe } = estimatePhase1(this.app, this.query);
    this.countEl.setText(
      maybe > 0
        ? `up to ${noteCount(certain + maybe)}`
        : noteCount(certain)
    );
  }

  // ---------- search ----------

  private async runSearch(): Promise<void> {
    this.searchAbort?.abort();
    this.searchAbort = new AbortController();
    this.searchBtn.disabled = true;
    this.searchBtn.setText("Searching…");
    try {
      const res = await search(this.app, this.query, {
        signal: this.searchAbort.signal,
      });
      this.results = res.files;
      this.selected.clear();
      if (this.plugin.settings.defaultSelectAll)
        res.files.forEach((f) => this.selected.add(f.path));
      this.resultsList.setFiles(res.files);
      this.countEl.setText(noteCount(res.files.length));
    } catch (e) {
      new Notice("Search failed: " + (e as Error).message);
    } finally {
      this.searchBtn.disabled = false;
      this.searchBtn.setText("Search");
      this.refreshApplyState();
    }
  }

  // ---------- apply state ----------

  private selectedFiles(): TFile[] {
    return this.results.filter((f) => this.selected.has(f.path));
  }

  private validOps(): EditOp[] {
    return this.ops.filter(isOpValid);
  }

  private canApply(): { ok: boolean; reason: string } {
    if (this.selectedFiles().length === 0)
      return { ok: false, reason: "Select at least one note." };
    if (this.ops.length === 0)
      return { ok: false, reason: "Add at least one operation." };
    if (this.ops.some((o) => !isOpValid(o)))
      return { ok: false, reason: "An operation is incomplete." };
    return { ok: true, reason: "" };
  }

  private refreshApplyState(): void {
    const { ok, reason } = this.canApply();
    this.applyBtn.disabled = !ok;
    const files = this.selectedFiles();
    if (ok) {
      this.applyNote.setText(
        `${this.ops.length} operation(s) on ${noteCount(files.length)}.`
      );
      this.applyNote.removeClass("is-warn");
    } else {
      this.applyNote.setText(reason);
      this.applyNote.addClass("is-warn");
    }
  }

  // ---------- apply flow ----------

  private async startApply(): Promise<void> {
    if (!this.canApply().ok) return;
    const files = this.selectedFiles();
    const summary = await buildSummary(
      this.app,
      files,
      this.validOps(),
      this.plugin.settings.regexScope
    );

    if (this.plugin.settings.confirmBeforeApply) {
      new ConfirmApplyModal(this.app, summary, () =>
        void this.doApply(files)
      ).open();
    } else {
      await this.doApply(files);
    }
  }

  private async doApply(files: TFile[]): Promise<void> {
    this.applyBtn.disabled = true;
    this.applyBtn.setText("Applying…");
    const ops = this.validOps();
    const scope = this.plugin.settings.regexScope;

    try {
      const { manifest } = await this.plugin.backup.createRun(
        files,
        this.query,
        ops
      );

      let okCount = 0;
      let failCount = 0;
      let totalReplacements = 0;
      const errors: string[] = [];
      const afterHashes = new Map<string, string>();

      for (const file of files) {
        const res = await applyToFile(this.app, file, ops, scope);
        if (res.ok) {
          okCount++;
          totalReplacements += res.regexReplacements;
        } else {
          failCount++;
          errors.push(`${res.path}: ${res.error}`);
        }
        try {
          afterHashes.set(
            file.path,
            hashString(await this.app.vault.read(file))
          );
        } catch {
          /* ignore */
        }
      }

      await this.plugin.backup.finalizeRun(manifest, afterHashes);

      const lines = [`Edited: ${okCount}`, `Failed: ${failCount}`];
      if (totalReplacements > 0)
        lines.push(`Regex replacements: ${totalReplacements}`);
      lines.push(`Backup: run ${manifest.runId}`);
      errors.slice(0, 20).forEach((e) => lines.push("Error " + e));
      new ResultModal(this.app, "Done", lines).open();
      new Notice(`Mass Editor: edited ${okCount}, failed ${failCount}.`);
    } catch (e) {
      new Notice("Apply failed: " + (e as Error).message);
    } finally {
      this.applyBtn.setText("Apply");
      this.refreshApplyState();
    }
  }
}
