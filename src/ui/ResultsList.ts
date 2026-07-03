import { type App, setIcon, type TFile } from "obsidian";
import { MatchPreviewModal, type RegexSpec } from "./modals";
import { noteCount, uid } from "./dom";
import type { ResultColumn, ColumnSource, ColumnType } from "../settings";
import { COLUMN_TYPES, columnValue } from "./columns";
import { ListSuggest, type SuggestSources } from "./suggest";

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
    /** Live column list (mutated in place; configured inline in the header). */
    private columns: ResultColumn[] = [],
    /** Persists a column change (e.g. plugin.saveSettings). */
    private saveColumns: () => void = () => {},
    /** Autocomplete source for frontmatter keys. */
    private sources?: SuggestSources
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

  private computeGrid(cols: ResultColumn[]): string {
    // checkbox · one flexible track per column · trailing actions / add-button
    const tracks = cols.map(() => "minmax(80px, 1fr)").join(" ");
    return `auto ${tracks} auto`.replace(/\s+/g, " ").trim();
  }

  /**
   * The header doubles as the column configurator: each cell carries a type
   * dropdown (plus a key field for frontmatter) and a remove button, and a
   * trailing "+" adds a new column.
   */
  private renderHead(): void {
    const cols = this.columns;
    this.gridTemplate = this.computeGrid(cols);
    this.head.empty();
    this.head.style.gridTemplateColumns = this.gridTemplate;
    // spacer cell aligned with each row's checkbox
    this.head.createDiv({ cls: "me-results__head-check" });
    cols.forEach((col, i) => this.renderHeadCell(col, i));

    const add = this.head.createDiv({ cls: "me-results__head-add" });
    const btn = add.createDiv({ cls: "clickable-icon" });
    setIcon(btn, "plus");
    btn.setAttribute("aria-label", "Add column");
    btn.onclick = () => {
      this.columns.push({ id: uid("col"), type: "frontmatter", key: "" });
      this.saveColumns();
      this.refreshColumns();
    };
  }

  private renderHeadCell(col: ResultColumn, i: number): void {
    const cell = this.head.createDiv({ cls: "me-results__head-cell" });
    cell.ondragover = (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      cell.addClass("is-drop-target");
    };
    cell.ondragleave = () => cell.removeClass("is-drop-target");
    cell.ondrop = (e) => {
      e.preventDefault();
      cell.removeClass("is-drop-target");
      const from = Number(e.dataTransfer?.getData("text/plain"));
      if (Number.isInteger(from)) this.moveColumn(from, i);
    };

    // Primary source row: drag handle · type/key · remove-column.
    const main = cell.createDiv({ cls: "me-col__row" });
    const grip = main.createDiv({ cls: "me-col__grip" });
    setIcon(grip, "grip-vertical");
    grip.setAttribute("aria-label", "Drag to reorder");
    grip.draggable = true;
    grip.ondragstart = (e) => {
      e.dataTransfer?.setData("text/plain", String(i));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    };
    this.renderSource(main, col);
    const del = main.createDiv({ cls: "clickable-icon me-col__remove" });
    setIcon(del, "x");
    del.setAttribute("aria-label", "Remove column");
    del.onclick = () => {
      this.columns.splice(i, 1);
      this.saveColumns();
      this.refreshColumns();
    };

    // Fallback (OR) alternatives, tried in order when earlier ones are empty.
    (col.alts ?? []).forEach((alt, ai) => {
      const row = cell.createDiv({ cls: "me-col__row me-col__alt" });
      row.createSpan({ cls: "me-col__or", text: "or" });
      this.renderSource(row, alt);
      const rm = row.createDiv({ cls: "clickable-icon me-col__remove" });
      setIcon(rm, "x");
      rm.setAttribute("aria-label", "Remove alternative");
      rm.onclick = () => {
        col.alts?.splice(ai, 1);
        if (col.alts && col.alts.length === 0) delete col.alts;
        this.saveColumns();
        this.refreshColumns();
      };
    });

    const addOr = cell.createSpan({ cls: "me-col__addor", text: "+ or" });
    addOr.setAttribute("aria-label", "Add fallback value");
    addOr.onclick = () => {
      (col.alts ??= []).push({ type: "frontmatter", key: "" });
      this.saveColumns();
      this.refreshColumns();
    };
  }

  /** Renders a type dropdown (+ frontmatter key field) bound to one source. */
  private renderSource(parent: HTMLElement, src: ColumnSource): void {
    const typeSel = parent.createEl("select", { cls: "dropdown me-col__type" });
    COLUMN_TYPES.forEach((t) => {
      const opt = typeSel.createEl("option", { text: t.label });
      opt.value = t.type;
      if (src.type === t.type) opt.selected = true;
    });
    typeSel.onchange = () => {
      src.type = typeSel.value as ColumnType;
      if (src.type !== "frontmatter") src.key = undefined;
      this.saveColumns();
      this.refreshColumns();
    };

    if (src.type !== "frontmatter") return;
    const keyInput = parent.createEl("input", {
      cls: "me-col__key",
      attr: { type: "text", placeholder: "key" },
    });
    keyInput.value = src.key ?? "";
    keyInput.oninput = () => {
      src.key = keyInput.value;
      this.saveColumns();
      this.renderWindow();
    };
    if (this.sources)
      new ListSuggest(
        this.app,
        keyInput,
        () => this.sources!.frontmatterKeys(),
        (v) => {
          src.key = v;
          this.saveColumns();
          this.renderWindow();
        }
      );
  }

  /** Moves the column at `from` to the slot occupied by index `to`. */
  private moveColumn(from: number, to: number): void {
    if (from === to || from < 0 || from >= this.columns.length) return;
    const [col] = this.columns.splice(from, 1);
    this.columns.splice(from < to ? to - 1 : to, 0, col);
    this.saveColumns();
    this.refreshColumns();
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
    const cols = this.columns;

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
