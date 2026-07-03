# Mass Editor

An Obsidian plugin for **mass search and editing** of notes across your vault. Build a visual query (nested AND/OR groups with NOT), get a list of notes, and run bulk edit operations on them — safely, with backups and undo.

The UI inherits your active Obsidian theme.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/B7K822EW68)

## Features

- **Visual query builder** with nested AND/OR groups and NOT.
- **Two-phase search engine** (metadata → content) with three-valued (Kleene) logic — note bodies are read only where metadata alone can't decide. Fast even on thousands of notes.
- **Fields:** tag, frontmatter (per key), body, name, path, location (folder + recursion), created/modified dates.
- **Edit operations:** frontmatter set / add / delete / append-to-list, tag add / remove, body append / prepend, regex find & replace (capture groups `$1`).
- **Result selection** via checkboxes (all selected by default), with a live count.
- **Configurable result columns:** show any metadata as table columns — frontmatter (per key), tags, file created / modified dates, folder path, and the note name itself. The header shows plain column titles; **click a title to edit** that column (type / frontmatter key), **drag** it to reorder, drag its right edge to **resize** (double-click to reset), and add columns with **+**. Each column can also list **OR fallbacks** — e.g. show frontmatter `author`, or `owner` when it's missing. The layout is remembered.
- **Resizable results pane:** drag the bottom edge of the results list to make it taller or shorter.
- **Regex match preview:** peek at the lines a regex operation will hit in any result (with the matches highlighted) before you run it.
- **Impact summary + change preview** before applying: a per-operation breakdown, plus an optional dry-run diff of the body transformation on a sample of the selected notes — nothing is written.
- **Backup + undo:** each run is a single transaction; restore from backup with drift detection. Only files that actually changed are backed up.
- **Git-style diff:** inspect exactly what an edit changed in any note — a line-by-line comparison (backup *before* vs current *after*), unified or side-by-side, with word-level highlighting.
- **Export report:** save a run as a Markdown note with a unified diff per file.
- **Presets:** save and reload a query + operations combination.
- **Layout:** single pane on desktop, two tabs on mobile.

## Install via BRAT

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) community plugin.
2. In BRAT choose **Add Beta Plugin** and enter the repository: `ondreu/mass-editor`.
3. BRAT downloads the latest release; enable the plugin in *Settings → Community plugins*.

Open it via the ribbon icon (⟳) or the command **Mass Editor: Open**.

## Usage

1. **Query** — compose rules and groups. The AND/OR toggle is on each group, the NOT toggle on both rules and groups. The live count shows an estimate (`up to N notes`, until content rules are evaluated).
2. **Search** — computes the full result (including reading bodies where needed).
3. **Results** — uncheck any notes you don't want to change (all selected by default). Columns show as a table with titled headers: **click a header** to edit it, **drag** to reorder, drag the right edge to resize, **+** to add. Drag the pane's bottom edge to make it taller.
4. **Operations** — add one or more edit operations.
5. **Apply** — an impact summary is shown; after confirmation a backup is created and the operations run.

Operation order is fixed and deterministic: **frontmatter → tags → regex → append/prepend**.

## Backups and undo

- Each edit run backs up the affected files (only those that actually changed) and writes a `manifest.json`.
- History and *Undo* are behind the history icon in the toolbar.
- Undo restores files from the backup. If a file was manually changed in the meantime (drift), the plugin warns and offers *skip / overwrite*.
- **View changes:** expand a run and click the compare icon next to a file for a git-style diff of the backup against the note's current content. Toggle **unified / side-by-side**; changed words within a line are highlighted; unchanged runs collapse into hunks with surrounding context.
- **Export report:** the download icon on a run writes a Markdown note (in the report folder) containing the run metadata and a fenced unified diff per file.

> **Backup location tradeoff:** the default backup folder is inside the plugin folder (`.obsidian/plugins/mass-editor/backups/`). That folder **may not sync** and **reinstalling the plugin can delete it**. For durable backups, set a path **inside your vault** (`backupFolder`) in Settings.

## Settings

| Key | Default | Description |
|-----|---------|-------------|
| Backup folder | plugin folder | Where to store backups |
| Backup retention | 20 | Number of runs to keep |
| Confirm before apply | on | Confirmation dialog |
| Select all results by default | on | New results start selected |
| Regex scope | body only | `body` (safe) / `whole file` (YAML risk) |
| Report folder | Mass Editor Reports | Vault folder for exported run reports |
| Side-by-side diff by default | off | Two-column diff layout instead of unified |
| Live count debounce | 200 ms | Recompute delay |

## Development

```bash
npm install
npm run dev      # watch build → main.js
npm run build    # typecheck + production bundle
npm test         # unit tests (engine, operators, op ordering)
```

Key modules: `src/query` (types, operators, evaluator, engine), `src/edit` (operations, applier, summary, diff, report), `src/backup` (backups + undo), `src/ui` (DOM components incl. shared diff renderer), `src/view` (main view).

Implementation safety: frontmatter/tags are edited exclusively through `app.fileManager.processFrontMatter`, and bodies through `app.vault.process` (atomic). No manual YAML parsing.

## License

MIT — see [LICENSE](LICENSE).
