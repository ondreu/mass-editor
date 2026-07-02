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
  private summaryEl!: HTMLElement;
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
    if (Platform.isMobile) root.addClass("is-mobile");

    this.renderHeader(root);

    if (Platform.isMobile) this.renderMobile(root);
    else this.renderDesktop(root);

    this.scheduleCount();
  }

  async onClose(): Promise<void> {
    this.searchAbort?.abort();
    this.contentEl.empty();
  }

  // ---------- layout ----------

  private renderHeader(root: HTMLElement): void {
    const header = root.createDiv({ cls: "me-header" });
    header.createDiv({ cls: "me-header__title", text: "Mass Editor" });
    this.countEl = header.createDiv({ cls: "me-header__count" });

    const actions = header.createDiv({ cls: "me-header__actions" });
    const hist = actions.createEl("button", { cls: "me-icon-btn" });
    setIcon(hist, "history");
    hist.setAttribute("aria-label", "Historie & undo");
    hist.onclick = () =>
      new HistoryModal(this.app, this.plugin.backup, () => {
        this.app.workspace.trigger("mass-editor:refresh");
      }).open();

    this.searchBtn = actions.createEl("button", {
      cls: "me-btn me-btn--primary",
      text: "Hledat",
    });
    this.searchBtn.onclick = () => void this.runSearch();
  }

  private section(parent: HTMLElement, title: string): HTMLElement {
    const sec = parent.createDiv({ cls: "me-section" });
    sec.createDiv({ cls: "me-section__title", text: title });
    return sec.createDiv({ cls: "me-section__body" });
  }

  private renderDesktop(root: HTMLElement): void {
    const wrap = root.createDiv({ cls: "me-body me-body--desktop" });
    const querySec = this.section(wrap, "Dotaz");
    this.mountBuilder(querySec);
    const resultsSec = this.section(wrap, "Výsledky");
    this.mountResults(resultsSec);
    const opsSec = this.section(wrap, "Editační operace");
    this.mountOps(opsSec);
    this.mountApplyBar(opsSec);
  }

  private renderMobile(root: HTMLElement): void {
    const tabs = root.createDiv({ cls: "me-tabs" });
    const tab1Btn = tabs.createEl("button", {
      cls: "me-tab is-active",
      text: "Filtr & výsledky",
    });
    const tab2Btn = tabs.createEl("button", {
      cls: "me-tab",
      text: "Editace",
    });

    const body = root.createDiv({ cls: "me-body me-body--mobile" });
    const panel1 = body.createDiv({ cls: "me-panel is-active" });
    const panel2 = body.createDiv({ cls: "me-panel" });

    this.mountBuilder(this.section(panel1, "Dotaz"));
    this.mountResults(this.section(panel1, "Výsledky"));
    this.mountOps(this.section(panel2, "Editační operace"));
    this.mountApplyBar(panel2);

    const activate = (idx: number) => {
      tab1Btn.toggleClass("is-active", idx === 0);
      tab2Btn.toggleClass("is-active", idx === 1);
      panel1.toggleClass("is-active", idx === 0);
      panel2.toggleClass("is-active", idx === 1);
    };
    tab1Btn.onclick = () => activate(0);
    tab2Btn.onclick = () => activate(1);
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
    this.opsPanel = new OperationsPanel(this.ops, () => this.onOpsChange());
    this.opsPanel.mount(container);
  }

  private mountApplyBar(parent: HTMLElement): void {
    const bar = parent.createDiv({ cls: "me-apply-bar" });
    this.summaryEl = bar.createDiv({ cls: "me-apply-bar__summary" });
    this.applyBtn = bar.createEl("button", {
      cls: "me-btn me-btn--primary me-btn--apply",
      text: "Aplikovat",
    });
    this.applyBtn.onclick = () => void this.startApply();
    this.refreshApplyState();
  }

  // ---------- živé počítadlo ----------

  private scheduleCount(): void {
    if (this.countTimer !== null) window.clearTimeout(this.countTimer);
    this.countTimer = window.setTimeout(
      () => this.updateCount(),
      this.plugin.settings.liveCountDebounceMs
    );
  }

  private updateCount(): void {
    const { certain, maybe } = estimatePhase1(this.app, this.query);
    if (maybe > 0) {
      this.countEl.setText(`až ${noteCount(certain + maybe)}`);
    } else {
      this.countEl.setText(noteCount(certain));
    }
  }

  // ---------- vyhledávání ----------

  private async runSearch(): Promise<void> {
    this.searchAbort?.abort();
    this.searchAbort = new AbortController();
    this.searchBtn.disabled = true;
    this.searchBtn.setText("Hledám…");
    try {
      const res = await search(this.app, this.query, {
        signal: this.searchAbort.signal,
      });
      this.results = res.files;
      this.selected.clear();
      if (this.plugin.settings.defaultSelectAll) {
        res.files.forEach((f) => this.selected.add(f.path));
      }
      this.resultsList.setFiles(res.files);
      this.countEl.setText(noteCount(res.files.length));
    } catch (e) {
      new Notice("Chyba při hledání: " + (e as Error).message);
    } finally {
      this.searchBtn.disabled = false;
      this.searchBtn.setText("Hledat");
      this.refreshApplyState();
    }
  }

  // ---------- operace / stav Aplikovat ----------

  private onOpsChange(): void {
    this.refreshApplyState();
  }

  private selectedFiles(): TFile[] {
    return this.results.filter((f) => this.selected.has(f.path));
  }

  private validOps(): EditOp[] {
    return this.ops.filter(isOpValid);
  }

  private canApply(): { ok: boolean; reason: string } {
    const files = this.selectedFiles();
    if (files.length === 0)
      return { ok: false, reason: "Vyberte alespoň jednu poznámku." };
    if (this.ops.length === 0)
      return { ok: false, reason: "Přidejte alespoň jednu operaci." };
    if (this.ops.some((o) => !isOpValid(o)))
      return { ok: false, reason: "Některá operace není kompletní." };
    return { ok: true, reason: "" };
  }

  private refreshApplyState(): void {
    const { ok, reason } = this.canApply();
    this.applyBtn.disabled = !ok;
    const files = this.selectedFiles();
    if (ok) {
      this.summaryEl.setText(
        `Připraveno: ${this.ops.length} operací na ${noteCount(files.length)}.`
      );
      this.summaryEl.removeClass("is-warn");
    } else {
      this.summaryEl.setText(reason);
      this.summaryEl.addClass("is-warn");
    }
  }

  // ---------- aplikační flow ----------

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
    this.applyBtn.setText("Aplikuji…");
    const ops = this.validOps();
    const scope = this.plugin.settings.regexScope;

    try {
      // 1) záloha
      const { manifest } = await this.plugin.backup.createRun(
        files,
        this.query,
        ops
      );

      // 2) aplikace per soubor, izolace chyb
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
          afterHashes.set(file.path, hashString(await this.app.vault.read(file)));
        } catch {
          /* ignore */
        }
      }

      // 3) finalizace běhu (hashAfter + historie + retence)
      await this.plugin.backup.finalizeRun(manifest, afterHashes);

      // 4) report
      const lines = [
        `Upraveno: ${okCount}`,
        `Selhalo: ${failCount}`,
      ];
      if (totalReplacements > 0)
        lines.push(`Regex nahrazení: ${totalReplacements}`);
      lines.push(`Záloha: běh ${manifest.runId}`);
      errors.slice(0, 20).forEach((e) => lines.push("Chyba " + e));
      new ResultModal(this.app, "Hotovo", lines).open();

      new Notice(`Mass Editor: upraveno ${okCount}, selhalo ${failCount}.`);
    } catch (e) {
      new Notice("Aplikace selhala: " + (e as Error).message);
    } finally {
      this.applyBtn.setText("Aplikovat");
      this.refreshApplyState();
    }
  }
}
