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
      return `${times} nastavit \`${op.key}\` = ${op.value}`;
    case "fm-add":
      return `${times} přidat \`${op.key}\` (jen kde chybí)`;
    case "fm-delete":
      return `${times} smazat klíč \`${op.key}\``;
    case "fm-list-append":
      return `${times} přidat "${op.value}" do listu \`${op.key}\``;
    case "tag-add":
      return `${times} přidat tag #${op.tag.replace(/^#/, "")}`;
    case "tag-remove":
      return `${times} odebrat tag #${op.tag.replace(/^#/, "")}`;
    case "body-append":
      return `${times} připojit text na konec`;
    case "body-prepend":
      return `${times} vložit text na začátek těla`;
    case "body-regex":
      return "";
  }
}

/**
 * Spočítá dopad operací na vybrané soubory.
 * Pro regex operace čte těla (dry-run) a počítá skutečné shody + varování.
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
          text: `Regex /${op.pattern}/ je neplatný.`,
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
        text: `${totalMatches} regex nahrazení v ${filesWithMatch} souborech`,
        tone: "normal",
      };
      if (totalMatches === 0) {
        line.tone = "warn";
        line.text += " — žádná shoda, zkontrolujte vzor";
      } else if (totalMatches > files.length * 50) {
        line.tone = "warn";
        line.text += " — velmi mnoho shod, ověřte vzor";
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
