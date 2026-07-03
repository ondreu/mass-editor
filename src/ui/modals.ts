import { type App, Modal, Notice, type TFile, setIcon } from "obsidian";
import type { ImpactSummary } from "../edit/summary";
import type {
  BackupManager,
  RunRecord,
  UndoPlan,
} from "../backup/backupManager";
import type MassEditorPlugin from "../main";
import type { Preset } from "../settings";
import type { Group } from "../query/types";
import { type EditOp, orderOps } from "../edit/operations";
import { type RegexScope, transformBody } from "../edit/applier";
import { buildReport, writeReport } from "../edit/report";
import { renderDiff } from "./diffView";
import { noteCount, uid } from "./dom";

const FM_KINDS = new Set<EditOp["kind"]>([
  "fm-set",
  "fm-add",
  "fm-delete",
  "fm-list-append",
  "tag-add",
  "tag-remove",
]);

/** Confirmation dialog showing the impact summary. */
export class ConfirmApplyModal extends Modal {
  constructor(
    app: App,
    private summary: ImpactSummary,
    private onConfirm: () => void,
    private onPreview?: () => void
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
    if (this.onPreview) {
      const preview = buttons.createEl("button", { text: "Preview changes" });
      preview.onclick = () => this.onPreview?.();
    }
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
  private backup: BackupManager;

  constructor(
    app: App,
    private plugin: MassEditorPlugin,
    private onAfterUndo: () => void
  ) {
    super(app);
    this.backup = plugin.backup;
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

    const exportBtn = row.createEl("div", { cls: "clickable-icon" });
    setIcon(exportBtn, "file-down");
    exportBtn.setAttribute("aria-label", "Export report (Markdown)");
    exportBtn.onclick = () => void this.doExport(rec);

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

      const diff = r.createEl("div", { cls: "clickable-icon me-history__diff" });
      setIcon(diff, "git-compare");
      diff.setAttribute("aria-label", "View changes");
      diff.onclick = (ev: MouseEvent) => {
        // The row is a <label> — stop it from toggling the checkbox.
        ev.preventDefault();
        ev.stopPropagation();
        new DiffModal(this.app, this.plugin, rec, entry.path).open();
      };
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

  private async doExport(rec: RunRecord): Promise<void> {
    try {
      const md = await buildReport(this.app, this.backup, rec);
      if (md === null) {
        new Notice("Mass Editor: backup not found for this run.");
        return;
      }
      const path = await writeReport(this.app, this.plugin, rec, md);
      new Notice(`Mass Editor: report saved to ${path}`);
      await this.app.workspace.openLinkText(path, path, true);
    } catch (e) {
      new Notice("Export failed: " + (e as Error).message);
    }
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

/** A unified/split toggle bound to the plugin's persisted preference. */
function viewToggle(
  parent: HTMLElement,
  plugin: MassEditorPlugin,
  onChange: () => void
): void {
  const wrap = parent.createDiv({ cls: "me-diff__toggle" });
  const mk = (label: string, split: boolean) => {
    const b = wrap.createEl("button", { text: label });
    if (plugin.settings.diffSplitView === split) b.addClass("is-active");
    b.onclick = () => {
      if (plugin.settings.diffSplitView === split) return;
      plugin.settings.diffSplitView = split;
      void plugin.saveSettings();
      onChange();
    };
  };
  mk("Unified", false);
  mk("Split", true);
}

/** Renders a stats line + diff view (respecting the persisted layout). */
function renderDiffBlock(
  parent: HTMLElement,
  before: string,
  after: string,
  split: boolean,
  emptyText = "No changes."
): void {
  const stats = parent.createDiv({ cls: "me-diff__stats" });
  const view = parent.createDiv();
  const { added, removed } = renderDiff(view, before, after, { split });
  if (added === 0 && removed === 0) {
    stats.setText(emptyText);
  } else {
    stats.createSpan({ cls: "me-diff__stat-add", text: `+${added}` });
    stats.createSpan({ cls: "me-diff__stat-del", text: `−${removed}` });
  }
}

/** Git-style comparison of a file's backup ("before") and current ("after"). */
export class DiffModal extends Modal {
  private data: { before: string; after: string } | null = null;

  constructor(
    app: App,
    private plugin: MassEditorPlugin,
    private record: RunRecord,
    private path: string
  ) {
    super(app);
  }

  onOpen(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.data = await this.plugin.backup.getDiff(this.record, this.path);
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("me-modal");
    contentEl.addClass("me-diff-modal");

    const head = contentEl.createDiv({ cls: "me-diff__header" });
    head.createEl("h3", { text: "Changes" });
    if (this.data) viewToggle(head, this.plugin, () => this.render());
    contentEl.createDiv({ cls: "me-diff__path", text: this.path });

    if (!this.data) {
      contentEl.createDiv({ cls: "me-op__error", text: "Backup not found." });
      return;
    }
    renderDiffBlock(
      contentEl,
      this.data.before,
      this.data.after,
      this.plugin.settings.diffSplitView,
      "No changes (identical to backup)."
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Dry-run preview of the pending edit on a sample of selected files. Shows the
 * body transformation (regex / append / prepend); frontmatter and tag changes
 * are summarised separately since they can't be simulated without writing.
 */
export class PreviewModal extends Modal {
  private static readonly SAMPLE = 10;

  constructor(
    app: App,
    private plugin: MassEditorPlugin,
    private files: TFile[],
    private ops: EditOp[],
    private regexScope: RegexScope
  ) {
    super(app);
  }

  onOpen(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const ordered = orderOps(this.ops);
    const bodyOps = ordered.filter((o) => !FM_KINDS.has(o.kind));
    const hasFm = ordered.some((o) => FM_KINDS.has(o.kind));
    const sample = this.files.slice(0, PreviewModal.SAMPLE);

    const previews: { path: string; before: string; after: string; error?: string }[] =
      [];
    for (const file of sample) {
      try {
        const before = await this.app.vault.cachedRead(file);
        const after =
          bodyOps.length > 0
            ? transformBody(this.app, file, before, bodyOps, this.regexScope, { n: 0 })
            : before;
        previews.push({ path: file.path, before, after });
      } catch (e) {
        previews.push({
          path: file.path,
          before: "",
          after: "",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    this.render(previews, hasFm, bodyOps.length === 0);
  }

  private render(
    previews: { path: string; before: string; after: string; error?: string }[],
    hasFm: boolean,
    noBodyOps: boolean
  ): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("me-modal");
    contentEl.addClass("me-diff-modal");

    const head = contentEl.createDiv({ cls: "me-diff__header" });
    head.createEl("h3", { text: "Preview changes" });
    viewToggle(head, this.plugin, () => void this.load());

    contentEl.createDiv({
      cls: "me-diff__note",
      text: `Dry run on ${noteCount(previews.length)}${
        this.files.length > previews.length
          ? ` (first ${previews.length} of ${this.files.length})`
          : ""
      }. Nothing is written.`,
    });
    if (hasFm) {
      contentEl.createDiv({
        cls: "me-diff__note is-warn",
        text: "Frontmatter / tag operations aren't shown here — see the impact summary for their counts.",
      });
    }
    if (noBodyOps) {
      contentEl.createDiv({
        cls: "me-empty",
        text: "No body operations to preview.",
      });
      return;
    }

    const split = this.plugin.settings.diffSplitView;
    for (const p of previews) {
      const block = contentEl.createDiv({ cls: "me-diff__file" });
      block.createDiv({ cls: "me-diff__path", text: p.path });
      if (p.error) {
        block.createDiv({ cls: "me-op__error", text: p.error });
        continue;
      }
      renderDiffBlock(block, p.before, p.after, split, "No body change.");
    }
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

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export interface RegexSpec {
  pattern: string;
  flags: string;
}

/** Shows lines matched by the current regex operations, with context. */
export class MatchPreviewModal extends Modal {
  private static readonly CONTEXT = 2;

  constructor(
    app: App,
    private file: TFile,
    private specs: RegexSpec[]
  ) {
    super(app);
  }

  onOpen(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("me-modal");
    contentEl.addClass("me-diff-modal");
    contentEl.createEl("h3", { text: "Regex matches" });
    contentEl.createDiv({ cls: "me-diff__path", text: this.file.path });

    let content = "";
    try {
      content = await this.app.vault.cachedRead(this.file);
    } catch (e) {
      contentEl.createDiv({
        cls: "me-op__error",
        text: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    const lines = content.replace(/\r\n/g, "\n").split("\n");

    // Build one global regex per spec (skip invalid).
    const regexes: RegExp[] = [];
    for (const s of this.specs) {
      try {
        regexes.push(
          new RegExp(s.pattern, s.flags.includes("g") ? s.flags : s.flags + "g")
        );
      } catch {
        /* invalid regex — skip */
      }
    }
    if (regexes.length === 0) {
      contentEl.createDiv({ cls: "me-empty", text: "No valid regex to match." });
      return;
    }

    // Which lines match any regex?
    const matched = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      for (const re of regexes) {
        re.lastIndex = 0;
        if (re.test(lines[i])) {
          matched.add(i);
          break;
        }
      }
    }
    if (matched.size === 0) {
      contentEl.createDiv({ cls: "me-empty", text: "No matches in this note." });
      return;
    }

    // Expand with context and merge into ranges.
    const keep = new Set<number>();
    for (const i of matched) {
      for (
        let k = Math.max(0, i - MatchPreviewModal.CONTEXT);
        k <= Math.min(lines.length - 1, i + MatchPreviewModal.CONTEXT);
        k++
      )
        keep.add(k);
    }

    contentEl.createDiv({
      cls: "me-diff__note",
      text: `${matched.size} matching line(s).`,
    });
    const view = contentEl.createDiv({ cls: "me-diff" });
    let prev = -1;
    Array.from(keep)
      .sort((a, b) => a - b)
      .forEach((i) => {
        if (prev >= 0 && i > prev + 1) {
          view.createDiv({ cls: "me-diff__hunk-head", text: "⋯" });
        }
        prev = i;
        const row = view.createDiv({
          cls: "me-diff__line" + (matched.has(i) ? " is-add" : ""),
        });
        row.createSpan({ cls: "me-diff__marker", text: String(i + 1) });
        const textEl = row.createSpan({ cls: "me-diff__text" });
        if (matched.has(i)) this.highlight(textEl, lines[i], regexes);
        else textEl.setText(lines[i]);
      });
  }

  /** Wraps the matched substrings of a line in highlight spans. */
  private highlight(el: HTMLElement, line: string, regexes: RegExp[]): void {
    // Collect match ranges across all regexes.
    const ranges: [number, number][] = [];
    for (const re of regexes) {
      re.lastIndex = 0;
      for (const m of line.matchAll(re)) {
        const start = m.index ?? 0;
        const end = start + m[0].length;
        if (end > start) ranges.push([start, end]);
      }
    }
    if (ranges.length === 0) {
      el.setText(line);
      return;
    }
    ranges.sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    for (const [start, end] of ranges) {
      if (start < cursor) continue; // skip overlaps
      if (start > cursor) el.appendText(line.slice(cursor, start));
      el.createSpan({ cls: "me-diff__word", text: line.slice(start, end) });
      cursor = end;
    }
    if (cursor < line.length) el.appendText(line.slice(cursor));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Save / load / delete query + operation presets. */
export class PresetsModal extends Modal {
  constructor(
    app: App,
    private plugin: MassEditorPlugin,
    private current: () => { query: Group; ops: EditOp[] },
    private onLoad: (preset: Preset) => void
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
    contentEl.createEl("h3", { text: "Presets" });

    // Save current query + operations as a new preset.
    const save = contentEl.createDiv({ cls: "me-preset-save" });
    const nameInput = save.createEl("input", {
      attr: { type: "text", placeholder: "New preset name…" },
    });
    const saveBtn = save.createEl("button", { cls: "mod-cta", text: "Save current" });
    saveBtn.onclick = async () => {
      const name = nameInput.value.trim();
      if (name === "") {
        new Notice("Enter a preset name.");
        return;
      }
      const { query, ops } = this.current();
      this.plugin.settings.presets.push({
        id: uid("p"),
        name,
        query: clone(query),
        ops: clone(ops),
      });
      await this.plugin.saveSettings();
      nameInput.value = "";
      this.render();
    };

    const presets = this.plugin.settings.presets;
    if (presets.length === 0) {
      contentEl.createDiv({ cls: "me-empty", text: "No presets yet." });
      return;
    }

    const list = contentEl.createDiv({ cls: "me-preset-list" });
    presets.forEach((p) => this.renderPreset(list, p));
  }

  private renderPreset(list: HTMLElement, preset: Preset): void {
    const row = list.createDiv({ cls: "me-preset" });
    const info = row.createDiv({ cls: "me-preset__info" });
    info.createDiv({ cls: "me-preset__name", text: preset.name });
    info.createDiv({
      cls: "me-history__meta",
      text: `${preset.ops.length} operation(s)`,
    });

    const load = row.createEl("button", { text: "Load" });
    load.onclick = () => {
      this.onLoad(preset);
      this.close();
    };

    const del = row.createEl("div", { cls: "clickable-icon" });
    setIcon(del, "trash-2");
    del.setAttribute("aria-label", "Delete preset");
    del.onclick = async () => {
      const idx = this.plugin.settings.presets.findIndex((x) => x.id === preset.id);
      if (idx >= 0) this.plugin.settings.presets.splice(idx, 1);
      await this.plugin.saveSettings();
      this.render();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
