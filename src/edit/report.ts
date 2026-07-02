import type { App, TFile } from "obsidian";
import type { BackupManager, RunRecord } from "../backup/backupManager";
import type MassEditorPlugin from "../main";
import { type EditOp, OP_LABELS } from "./operations";
import { unifiedDiff } from "./diff";

/** Human-readable one-line description of an operation. */
function describeOp(op: EditOp): string {
  const label = OP_LABELS[op.kind];
  switch (op.kind) {
    case "fm-set":
    case "fm-add":
      return `${label}: \`${op.key}\` = \`${op.value}\` (${op.valueType})`;
    case "fm-delete":
      return `${label}: \`${op.key}\``;
    case "fm-list-append":
      return `${label}: \`${op.key}\` += \`${op.value}\``;
    case "tag-add":
    case "tag-remove":
      return `${label}: \`#${op.tag}\``;
    case "body-regex":
      return `${label}: \`/${op.pattern}/${op.flags}\` → \`${op.replacement}\``;
    case "body-append":
    case "body-prepend":
      return `${label}: ${op.text.length} char(s)`;
  }
}

/**
 * Builds a Markdown report for a run: metadata, the operations that ran, and a
 * git-style unified diff per file (backup vs current). Returns null if the run
 * manifest is missing.
 */
export async function buildReport(
  app: App,
  backup: BackupManager,
  rec: RunRecord
): Promise<string | null> {
  const manifest = await backup.readManifest(rec);
  if (!manifest) return null;

  const out: string[] = [];
  out.push("# Mass Editor run report", "");
  out.push(`- **Run ID:** ${manifest.runId}`);
  out.push(`- **Date:** ${new Date(manifest.timestamp).toLocaleString()}`);
  out.push(`- **Files:** ${manifest.files.length}`);
  out.push(`- **Operations:** ${manifest.operations.length}`, "");

  out.push("## Operations", "");
  if (manifest.operations.length === 0) out.push("_None._", "");
  else {
    for (const op of manifest.operations) out.push(`- ${describeOp(op)}`);
    out.push("");
  }

  out.push("## Changes", "");
  for (const entry of manifest.files) {
    out.push(`### ${entry.path}`, "");
    const d = await backup.getDiff(rec, entry.path);
    const patch = d ? unifiedDiff(d.before, d.after, entry.path) : "";
    if (!patch) {
      out.push("_No changes._", "");
      continue;
    }
    out.push("```diff", patch, "```", "");
  }
  return out.join("\n");
}

/**
 * Writes the report as a note in the configured report folder and returns its
 * vault path. Overwrites an existing report for the same run.
 */
export async function writeReport(
  app: App,
  plugin: MassEditorPlugin,
  rec: RunRecord,
  markdown: string
): Promise<string> {
  const folder = (plugin.settings.reportFolder || "Mass Editor Reports")
    .replace(/^\/+|\/+$/g, "")
    .trim();
  if (folder && !(await app.vault.adapter.exists(folder))) {
    try {
      await app.vault.createFolder(folder);
    } catch {
      /* may already exist / race */
    }
  }
  const path = folder ? `${folder}/run-${rec.runId}.md` : `run-${rec.runId}.md`;
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing && "stat" in existing) {
    await app.vault.modify(existing as TFile, markdown);
  } else {
    await app.vault.create(path, markdown);
  }
  return path;
}
