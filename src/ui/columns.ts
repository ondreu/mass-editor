import { type App, type TFile, getAllTags } from "obsidian";
import type { ResultColumn, ColumnType } from "../settings";

/** Column types the user can choose from, in the order shown in the picker. */
export const COLUMN_TYPES: { type: ColumnType; label: string }[] = [
  { type: "name", label: "Note name" },
  { type: "path", label: "Folder path" },
  { type: "frontmatter", label: "Frontmatter" },
  { type: "tags", label: "Tags" },
  { type: "created", label: "Created" },
  { type: "modified", label: "Modified" },
];

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

/** Computes the display value of a column for a given file. */
export function columnValue(app: App, file: TFile, col: ResultColumn): string {
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
