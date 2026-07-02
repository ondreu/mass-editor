import type { TFile } from "obsidian";
import { noteCount } from "./dom";

const ROW_HEIGHT = 40; // px, musí odpovídat .me-result v CSS
const BUFFER = 6;

/** Virtualizovaný seznam výsledků s checkboxy. */
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
    const toolbar = container.createDiv({ cls: "me-results__toolbar" });

    const left = toolbar.createDiv({ cls: "me-results__selall" });
    this.headerCheck = left.createEl("input", { attr: { type: "checkbox" } });
    this.headerCheck.onchange = () => {
      if (this.headerCheck.checked) {
        this.files.forEach((f) => this.selected.add(f.path));
      } else {
        this.selected.clear();
      }
      this.renderWindow();
      this.updateCount();
      this.onChange();
    };
    left.createEl("label", { text: "Vybrat vše" });

    this.countEl = toolbar.createDiv({ cls: "me-results__count" });

    this.viewport = container.createDiv({ cls: "me-results__viewport" });
    this.spacer = this.viewport.createDiv({ cls: "me-results__spacer" });
    this.rows = this.spacer.createDiv({ cls: "me-results__rows" });
    this.viewport.addEventListener("scroll", () => this.renderWindow());
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
        ? "Žádné výsledky"
        : `${noteCount(this.files.length)} • vybráno ${sel}`
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
    const height = this.viewport.clientHeight || 400;
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
      cb.onchange = () => {
        if (cb.checked) this.selected.add(file.path);
        else this.selected.delete(file.path);
        this.updateCount();
        this.onChange();
      };

      const info = row.createDiv({ cls: "me-result__info" });
      info.createDiv({ cls: "me-result__name", text: file.basename });
      const dir = file.parent && file.parent.path !== "/" ? file.parent.path : "";
      if (dir) info.createDiv({ cls: "me-result__path", text: dir });

      row.onclick = (e) => {
        if (e.target === cb) return;
        cb.checked = !cb.checked;
        cb.onchange?.(new Event("change"));
      };
    }
  }
}
