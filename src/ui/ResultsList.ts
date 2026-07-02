import type { TFile } from "obsidian";
import { noteCount } from "./dom";

const ROW_HEIGHT = 30; // px, must match .me-result in styles.css
const BUFFER = 6;

/** Virtualized results list with checkboxes. */
export class ResultsList {
  private files: TFile[] = [];
  private selected: Set<string>;
  private viewport!: HTMLElement;
  private spacer!: HTMLElement;
  private rows!: HTMLElement;
  private countEl!: HTMLElement;
  private headerCheck!: HTMLInputElement;

  constructor(selected: Set<string>, private onChange: () => void) {
    this.selected = selected;
  }

  mount(container: HTMLElement): void {
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

    this.viewport = container.createDiv({ cls: "me-results__viewport" });
    this.spacer = this.viewport.createDiv({ cls: "me-results__spacer" });
    this.rows = this.spacer.createDiv({ cls: "me-results__rows" });
    this.viewport.addEventListener("scroll", () => this.renderWindow());
    this.updateCount();
  }

  setFiles(files: TFile[]): void {
    this.files = files;
    this.spacer.style.height = `${files.length * ROW_HEIGHT}px`;
    this.viewport.scrollTop = 0;
    this.renderWindow();
    this.updateCount();
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

    this.rows.empty();
    this.rows.style.transform = `translateY(${first * ROW_HEIGHT}px)`;

    for (let i = first; i < last; i++) {
      const file = this.files[i];
      const row = this.rows.createDiv({ cls: "me-result" });

      const cb = row.createEl("input", { attr: { type: "checkbox" } });
      cb.checked = this.selected.has(file.path);
      const toggle = () => {
        if (cb.checked) this.selected.add(file.path);
        else this.selected.delete(file.path);
        this.updateCount();
        this.onChange();
      };
      cb.onchange = toggle;

      row.createDiv({ cls: "me-result__name", text: file.basename });
      const dir =
        file.parent && file.parent.path !== "/" ? file.parent.path : "";
      if (dir) row.createDiv({ cls: "me-result__path", text: dir });

      row.onclick = (e) => {
        if (e.target === cb) return;
        cb.checked = !cb.checked;
        toggle();
      };
    }
  }
}
