import { type App, setIcon, type TFile } from "obsidian";
import { MatchPreviewModal, type RegexSpec } from "./modals";
import { noteCount } from "./dom";
import type { ResultColumn } from "../settings";
import { columnHeader, columnValue } from "./columns";

const ROW_HEIGHT = 30; // px, must match .me-result in styles.css
const BUFFER = 6;

/** Virtualized results list with checkboxes and configurable metadata columns. */
export class ResultsList {
  private files: TFile[] = [];
  private selected: Set<string>;
  private viewport!: HTMLElement;
  private spacer!: HTMLElement;
  private rows!: HTMLElement;
  private head!: HTMLElement;
  private countEl!: HTMLElement;
  private headerCheck!: HTMLInputElement;
  private gridTemplate = "";
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private app: App,
    selected: Set<string>,
    private onChange: () => void,
    /** Returns the current body-regex operations (for the match preview). */
    private getRegexSpecs: () => RegexSpec[] = () => [],
    /** Columns to display (name is present by default, all hideable). */
    private getColumns: () => ResultColumn[] = () => [],
    /** Opens the column configuration UI. */
    private onConfigure: () => void = () => {}
  ) {
    this.selected = selected;
  }

  mount(container: HTMLElement): void {
    this.resizeObserver?.disconnect();
    container.empty();
    const bar = container.createDiv({ cls: "me-results__bar" });

    const label = bar.createEl("label");
    this.headerCheck = label.createEl("input", { attr: { type: "checkbox" } });
    label.createSpan({ text: "Select all" });
    this.headerCheck.onchange = () => {
      if (this.headerCheck.checked)
        this.files.forEach((f) => this.selected.add(f.path));
      else this.selected.clear();
      this.renderWindow();
      this.updateCount();
      this.onChange();
    };

    this.countEl = bar.createDiv({ cls: "me-results__count" });

    const cog = bar.createDiv({ cls: "clickable-icon me-results__config" });
    setIcon(cog, "settings-2");
    cog.setAttribute("aria-label", "Configure columns");
    cog.onclick = () => this.onConfigure();

    this.head = container.createDiv({ cls: "me-results__head" });

    this.viewport = container.createDiv({ cls: "me-results__viewport" });
    this.spacer = this.viewport.createDiv({ cls: "me-results__spacer" });
    this.rows = this.spacer.createDiv({ cls: "me-results__rows" });
    this.viewport.addEventListener("scroll", () => this.renderWindow());
    // The viewport is user-resizable (CSS `resize: vertical`); re-render the
    // virtualized window whenever its height changes so the buffer stays right.
    this.resizeObserver = new ResizeObserver(() => this.renderWindow());
    this.resizeObserver.observe(this.viewport);

    this.renderHead();
    this.updateCount();
  }

  setFiles(files: TFile[]): void {
    this.files = files;
    this.spacer.style.height = `${files.length * ROW_HEIGHT}px`;
    this.viewport.scrollTop = 0;
    this.renderWindow();
    this.updateCount();
  }

  /** Re-renders the header and rows after the column configuration changed. */
  refreshColumns(): void {
    this.renderHead();
    this.renderWindow();
  }

  private visibleColumns(): ResultColumn[] {
    return this.getColumns().filter((c) => !c.hidden);
  }

  private computeGrid(cols: ResultColumn[]): string {
    // checkbox · one flexible track per column · trailing actions
    const tracks = cols.map(() => "minmax(60px, 1fr)").join(" ");
    return `auto ${tracks} auto`.replace(/\s+/g, " ").trim();
  }

  private renderHead(): void {
    const cols = this.visibleColumns();
    this.gridTemplate = this.computeGrid(cols);
    this.head.empty();
    this.head.style.gridTemplateColumns = this.gridTemplate;
    // spacer cell aligned with each row's checkbox
    this.head.createDiv({ cls: "me-results__head-check" });
    for (const col of cols) {
      this.head.createDiv({
        cls: "me-results__head-cell",
        text: columnHeader(col),
      });
    }
    this.head.createDiv({ cls: "me-results__head-actions" });
  }

  private updateCount(): void {
    const sel = this.selectedCount();
    this.countEl.setText(
      this.files.length === 0
        ? "No results"
        : `${noteCount(this.files.length)} · ${sel} selected`
    );
    this.headerCheck.checked =
      this.files.length > 0 && sel === this.files.length;
    this.headerCheck.indeterminate = sel > 0 && sel < this.files.length;
  }

  private selectedCount(): number {
    let n = 0;
    for (const f of this.files) if (this.selected.has(f.path)) n++;
    return n;
  }

  private renderWindow(): void {
    const scrollTop = this.viewport.scrollTop;
    const height = this.viewport.clientHeight || 260;
    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
    const visible = Math.ceil(height / ROW_HEIGHT) + BUFFER * 2;
    const last = Math.min(this.files.length, first + visible);
    const cols = this.visibleColumns();

    this.rows.empty();
    this.rows.style.transform = `translateY(${first * ROW_HEIGHT}px)`;

    for (let i = first; i < last; i++) {
      const file = this.files[i];
      const row = this.rows.createDiv({ cls: "me-result" });
      row.style.gridTemplateColumns = this.gridTemplate;

      const cb = row.createEl("input", { attr: { type: "checkbox" } });
      cb.checked = this.selected.has(file.path);
      const toggle = () => {
        if (cb.checked) this.selected.add(file.path);
        else this.selected.delete(file.path);
        this.updateCount();
        this.onChange();
      };
      cb.onchange = toggle;

      for (const col of cols) this.renderCell(row, file, col);

      const actions = row.createDiv({ cls: "me-result__actions" });
      const specs = this.getRegexSpecs();
      if (specs.length > 0) {
        const peek = actions.createDiv({ cls: "clickable-icon me-result__peek" });
        setIcon(peek, "search");
        peek.setAttribute("aria-label", "Preview regex matches");
        peek.onclick = (e) => {
          e.stopPropagation();
          new MatchPreviewModal(this.app, file, specs).open();
        };
      }

      const open = actions.createDiv({ cls: "clickable-icon me-result__open" });
      setIcon(open, "external-link");
      open.setAttribute("aria-label", "Open in new tab");
      open.onclick = (e) => {
        e.stopPropagation();
        void this.app.workspace.openLinkText(file.path, file.path, true);
      };

      // Clicking elsewhere on the row toggles the checkbox.
      row.onclick = () => {
        cb.checked = !cb.checked;
        toggle();
      };
    }
  }

  /** Renders one metadata cell; the note-name cell opens the note on click. */
  private renderCell(row: HTMLElement, file: TFile, col: ResultColumn): void {
    const value = columnValue(this.app, file, col);
    if (col.type === "name") {
      const name = row.createDiv({
        cls: "me-result__cell me-result__name",
        text: value,
      });
      name.onclick = (e) => {
        e.stopPropagation();
        void this.app.workspace.openLinkText(
          file.path,
          file.path,
          e.ctrlKey || e.metaKey
        );
      };
      name.addEventListener("mouseover", (e) => {
        this.app.workspace.trigger("hover-link", {
          event: e,
          source: "mass-editor",
          hoverParent: this.viewport,
          targetEl: name,
          linktext: file.path,
        });
      });
      return;
    }
    const cell = row.createDiv({
      cls: `me-result__cell me-result__cell--${col.type}`,
      text: value,
    });
    if (value !== "") cell.setAttribute("aria-label", value);
  }
}
