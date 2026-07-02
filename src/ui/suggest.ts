import { AbstractInputSuggest, type App, TFolder, getAllTags } from "obsidian";

/**
 * Generic input autocomplete backed by a list provider.
 * Filters case-insensitively by substring; picking updates the input and
 * notifies the caller.
 */
export class ListSuggest extends AbstractInputSuggest<string> {
  private el: HTMLInputElement;

  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private items: () => string[],
    private onPick: (value: string) => void
  ) {
    super(app, inputEl);
    this.el = inputEl;
  }

  getSuggestions(query: string): string[] {
    const q = query.toLowerCase().trim();
    const all = this.items();
    const matches = q === ""
      ? all
      : all.filter((i) => i.toLowerCase().includes(q));
    return matches.slice(0, 100);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string): void {
    this.setValue(value);
    this.onPick(value);
    this.close();
  }
}

/**
 * Cached lists of tags / folders / frontmatter keys used for autocomplete.
 * Recompute lazily; call `invalidate()` when the vault likely changed.
 */
export class SuggestSources {
  private tagCache: string[] | null = null;
  private folderCache: string[] | null = null;
  private keyCache: string[] | null = null;

  constructor(private app: App) {}

  invalidate(): void {
    this.tagCache = null;
    this.folderCache = null;
    this.keyCache = null;
  }

  tags(): string[] {
    if (this.tagCache) return this.tagCache;
    const set = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) continue;
      for (const t of getAllTags(cache) ?? []) set.add(t.replace(/^#/, ""));
    }
    this.tagCache = [...set].sort();
    return this.tagCache;
  }

  folders(): string[] {
    if (this.folderCache) return this.folderCache;
    const out: string[] = [];
    for (const f of this.app.vault.getAllLoadedFiles()) {
      if (f instanceof TFolder && f.path !== "/") out.push(f.path);
    }
    this.folderCache = out.sort();
    return this.folderCache;
  }

  frontmatterKeys(): string[] {
    if (this.keyCache) return this.keyCache;
    const set = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm) for (const k of Object.keys(fm)) if (k !== "position") set.add(k);
    }
    this.keyCache = [...set].sort();
    return this.keyCache;
  }
}
