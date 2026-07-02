# Mass Editor

An Obsidian plugin for **mass search and editing** of notes across your vault. Build a visual query (nested AND/OR groups with NOT), get a list of notes, and run bulk edit operations on them — safely, with backups and undo.

The UI inherits your active Obsidian theme.

## Features

- **Visual query builder** with nested AND/OR groups and NOT.
- **Two-phase search engine** (metadata → content) with three-valued (Kleene) logic — note bodies are read only where metadata alone can't decide. Fast even on thousands of notes.
- **Fields:** tag, frontmatter (per key), body, name, path, location (folder + recursion), created/modified dates.
- **Edit operations:** frontmatter set / add / delete / append-to-list, tag add / remove, body append / prepend, regex find & replace (capture groups `$1`).
- **Result selection** via checkboxes (all selected by default), with a live count.
- **Impact summary** before applying (note count, per-operation breakdown, regex match count + warnings).
- **Backup + undo:** each run is a single transaction; restore from backup with drift detection.
- **Layout:** single pane on desktop, two tabs on mobile.

## Install via BRAT

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) community plugin.
2. In BRAT choose **Add Beta Plugin** and enter the repository: `ondreu/mass-editor`.
3. BRAT downloads the latest release; enable the plugin in *Settings → Community plugins*.

Open it via the ribbon icon (⟳) or the command **Mass Editor: Open**.

## Usage

1. **Query** — compose rules and groups. The AND/OR toggle is on each group, the NOT toggle on both rules and groups. The live count shows an estimate (`up to N notes`, until content rules are evaluated).
2. **Search** — computes the full result (including reading bodies where needed).
3. **Results** — uncheck any notes you don't want to change (all selected by default).
4. **Operations** — add one or more edit operations.
5. **Apply** — an impact summary is shown; after confirmation a backup is created and the operations run.

Operation order is fixed and deterministic: **frontmatter → tags → regex → append/prepend**.

## Backups and undo

- Each edit run first backs up the affected files and writes a `manifest.json`.
- History and *Undo* are behind the history icon in the toolbar.
- Undo restores files from the backup. If a file was manually changed in the meantime (drift), the plugin warns and offers *skip / overwrite*.

> **Backup location tradeoff:** the default backup folder is inside the plugin folder (`.obsidian/plugins/mass-editor/backups/`). That folder **may not sync** and **reinstalling the plugin can delete it**. For durable backups, set a path **inside your vault** (`backupFolder`) in Settings.

## Settings

| Key | Default | Description |
|-----|---------|-------------|
| Backup folder | plugin folder | Where to store backups |
| Backup retention | 20 | Number of runs to keep |
| Confirm before apply | on | Confirmation dialog |
| Select all results by default | on | New results start selected |
| Regex scope | body only | `body` (safe) / `whole file` (YAML risk) |
| Live count debounce | 200 ms | Recompute delay |

## Development

```bash
npm install
npm run dev      # watch build → main.js
npm run build    # typecheck + production bundle
npm test         # unit tests (engine, operators, op ordering)
```

Key modules: `src/query` (types, operators, evaluator, engine), `src/edit` (operations, applier, summary), `src/backup` (backups + undo), `src/ui` (DOM components), `src/view` (main view).

Implementation safety: frontmatter/tags are edited exclusively through `app.fileManager.processFrontMatter`, and bodies through `app.vault.process` (atomic). No manual YAML parsing.

## License

MIT — see [LICENSE](LICENSE).
