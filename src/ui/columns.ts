import { type App, type TFile, getAllTags } from "obsidian";
import type { ResultColumn, ColumnSource, ColumnType } from "../settings";

/** Column types the user can choose from, in the order shown in the picker. */
export const COLUMN_TYPES: { type: ColumnType; label: string }[] = [
  { type: "name", label: "Note name" },
  { type: "path", label: "Folder path" },
  { type: "frontmatter", label: "Frontmatter" },
  { type: "tags", label: "Tags" },
  { type: "created", label: "Created" },
  { type: "modified", label: "Modified" },
];

const TYPE_LABEL = new Map(COLUMN_TYPES.map((t) => [t.type, t.label]));

/** Human-readable name for a single source. */
export function sourceLabel(src: ColumnSource): string {
  if (src.type === "frontmatter")
    return src.key && src.key.trim() !== "" ? src.key.trim() : "Frontmatter";
  return TYPE_LABEL.get(src.type) ?? src.type;
}

/** Header label for a column (its primary source's name). */
export function columnLabel(col: ResultColumn): string {
  return sourceLabel(col);
}

/** Renders a single value into a stringy form for a table cell. */
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(formatValue).filter((s) => s !== "").join(", ");
  if (v instanceof Date) return v.toLocaleDateString();
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Computes a column's display value: the primary source, falling back to each
 * alternative in turn (OR / coalesce) until one yields a non-empty value.
 */
export function columnValue(app: App, file: TFile, col: ResultColumn): string {
  const primary = sourceValue(app, file, col);
  if (primary !== "") return primary;
  for (const alt of col.alts ?? []) {
    const v = sourceValue(app, file, alt);
    if (v !== "") return v;
  }
  return "";
}

/** Computes the value of a single source (no fallback). */
function sourceValue(app: App, file: TFile, col: ColumnSource): string {
  switch (col.type) {
    case "name":
      return file.basename;
    case "path":
      return file.parent && file.parent.path !== "/" ? file.parent.path : "";
    case "created":
      return formatDate(file.stat.ctime);
    case "modified":
      return formatDate(file.stat.mtime);
    case "tags": {
      const cache = app.metadataCache.getFileCache(file);
      const tags = cache ? getAllTags(cache) ?? [] : [];
      return [...new Set(tags)].join(" ");
    }
    case "frontmatter": {
      const key = col.key?.trim();
      if (!key) return "";
      const fm = app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || !(key in fm)) return "";
      return formatValue(fm[key]);
    }
    default:
      return "";
  }
}
