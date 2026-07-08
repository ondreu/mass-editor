/**
 * Value variables for frontmatter "set" / "add" operations.
 *
 * A frontmatter value may contain `{{…}}` placeholders that are resolved per
 * file at apply time — e.g. `{{title}}`, `{{today}}`, `{{modified}}`. Date
 * placeholders accept an optional format suffix, e.g. `{{modified:YYYY/MM/DD}}`.
 */

/** Per-file data used to resolve value placeholders. */
export interface FmVarContext {
  /** Note name without extension. */
  basename: string;
  /** Full vault-relative path. */
  path: string;
  /** Parent folder path ("" for a vault-root note). */
  folder: string;
  /** File creation time (ms since epoch). */
  ctime: number;
  /** File modification time (ms since epoch). */
  mtime: number;
  /** "Now" reference time (ms since epoch). */
  now: number;
}

/** A placeholder offered in the UI. */
export interface FmVariable {
  /** Text inserted into the value field, e.g. "{{title}}". */
  insert: string;
  /** Human-readable menu label. */
  label: string;
}

/** Variables offered by the UI menu (in display order). */
export const FM_VARIABLES: FmVariable[] = [
  { insert: "{{title}}", label: "Note name" },
  { insert: "{{path}}", label: "Note path" },
  { insert: "{{folder}}", label: "Folder" },
  { insert: "{{today}}", label: "Today's date" },
  { insert: "{{now}}", label: "Now (date + time)" },
  { insert: "{{time}}", label: "Current time" },
  { insert: "{{created}}", label: "Created date" },
  { insert: "{{modified}}", label: "Modified date" },
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Formats a timestamp with a small token set: YYYY, YY, MM, DD, HH, mm, ss
 * (local time). Longer tokens are substituted before their shorter overlaps.
 */
export function formatDate(ms: number, fmt: string): string {
  const d = new Date(ms);
  return fmt
    .replace(/YYYY/g, String(d.getFullYear()))
    .replace(/YY/g, pad(d.getFullYear() % 100))
    .replace(/MM/g, pad(d.getMonth() + 1))
    .replace(/DD/g, pad(d.getDate()))
    .replace(/HH/g, pad(d.getHours()))
    .replace(/mm/g, pad(d.getMinutes()))
    .replace(/ss/g, pad(d.getSeconds()));
}

/**
 * Resolves `{{…}}` placeholders in a value. Unknown placeholders are left
 * untouched so literal `{{ }}` text survives. Date placeholders take an
 * optional `:format` suffix.
 */
export function renderFmValue(value: string, ctx: FmVarContext): string {
  return value.replace(
    /\{\{\s*([a-zA-Z_]+)\s*(?::([^}]*))?\}\}/g,
    (match, rawName: string, rawFmt: string | undefined) => {
      const name = rawName.toLowerCase();
      const fmt = rawFmt?.trim();
      switch (name) {
        case "title":
        case "name":
          return ctx.basename;
        case "path":
          return ctx.path;
        case "folder":
          return ctx.folder;
        case "today":
        case "date":
          return formatDate(ctx.now, fmt || "YYYY-MM-DD");
        case "now":
          return formatDate(ctx.now, fmt || "YYYY-MM-DD HH:mm");
        case "time":
          return formatDate(ctx.now, fmt || "HH:mm");
        case "created":
          return formatDate(ctx.ctime, fmt || "YYYY-MM-DD");
        case "modified":
          return formatDate(ctx.mtime, fmt || "YYYY-MM-DD");
        default:
          return match;
      }
    }
  );
}
