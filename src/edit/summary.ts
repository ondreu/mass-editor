import type { App, TFile } from "obsidian";
import type { EditOp } from "./operations";
import { OP_LABELS } from "./operations";
import type { RegexScope } from "./applier";
import { stripFrontmatter } from "../query/engine";

export interface SummaryLine {
  text: string;
  tone: "normal" | "warn";
}

export interface ImpactSummary {
  fileCount: number;
  lines: SummaryLine[];
}

function ensureGlobal(flags: string): string {
  return flags.includes("g") ? flags : flags + "g";
}

function describeOp(op: EditOp, n: number): string {
  const times = `${n}×`;
  switch (op.kind) {
    case "fm-set":
      return `${times} set \`${op.key}\` = ${op.value}`;
    case "fm-add":
      return `${times} add \`${op.key}\` (only where missing)`;
    case "fm-delete":
      return `${times} delete key \`${op.key}\``;
    case "fm-list-append":
      return `${times} append "${op.value}" to list \`${op.key}\``;
    case "tag-add":
      return `${times} add tag #${op.tag.replace(/^#/, "")}`;
    case "tag-remove":
      return `${times} remove tag #${op.tag.replace(/^#/, "")}`;
    case "body-append":
      return `${times} append text to end`;
    case "body-prepend":
      return `${times} prepend text to body`;
    case "body-regex":
      return "";
  }
}

/**
 * Computes the impact of the operations on the selected files.
 * For regex operations it reads bodies (dry-run) and counts real matches + warnings.
 */
export async function buildSummary(
  app: App,
  files: TFile[],
  ops: EditOp[],
  scope: RegexScope
): Promise<ImpactSummary> {
  const lines: SummaryLine[] = [];

  for (const op of ops) {
    if (op.kind === "body-regex") {
      const re = safeRegex(op.pattern, ensureGlobal(op.flags));
      if (!re) {
        lines.push({
          text: `Regex /${op.pattern}/ is invalid.`,
          tone: "warn",
        });
        continue;
      }
      let totalMatches = 0;
      let filesWithMatch = 0;
      for (const file of files) {
        const raw = await app.vault.cachedRead(file);
        const target =
          scope === "body" ? stripFrontmatter(app, file, raw) : raw;
        const m = target.match(re);
        if (m && m.length > 0) {
          totalMatches += m.length;
          filesWithMatch++;
        }
      }
      const line: SummaryLine = {
        text: `${totalMatches} regex replacements in ${filesWithMatch} files`,
        tone: "normal",
      };
      if (totalMatches === 0) {
        line.tone = "warn";
        line.text += " — no matches, check the pattern";
      } else if (totalMatches > files.length * 50) {
        line.tone = "warn";
        line.text += " — very many matches, verify the pattern";
      }
      lines.push(line);
    } else {
      lines.push({ text: describeOp(op, files.length), tone: "normal" });
    }
  }

  return { fileCount: files.length, lines };
}

function safeRegex(pattern: string, flags: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}
