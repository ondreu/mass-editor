import type { App, TFile } from "obsidian";
import { type EditOp, coerceValue, orderOps } from "./operations";

export type RegexScope = "body" | "whole";

export interface ApplyResult {
  path: string;
  ok: boolean;
  error?: string;
  regexReplacements: number;
  changed: boolean;
}

function normTag(t: string): string {
  return t.replace(/^#+/, "").trim();
}

/** Ensures the value is a string array (tags may be a string / list / missing). */
function toStringArray(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s !== "");
  if (typeof v === "string")
    return v
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => s !== "");
  return [String(v)];
}

function ensureGlobal(flags: string): string {
  return flags.includes("g") ? flags : flags + "g";
}

/** End of the frontmatter block (offset in content), or 0 if none. */
function frontmatterEnd(app: App, file: TFile, content: string): number {
  const cache = app.metadataCache.getFileCache(file);
  const end = cache?.frontmatterPosition?.end.offset;
  if (typeof end === "number" && end > 0 && end <= content.length) {
    // frontmatterPosition end is at `---`; skip a following newline if present
    let e = end;
    if (content[e] === "\n") e++;
    return e;
  }
  return 0;
}

/** Applies frontmatter + tag operations in a single atomic pass. */
async function applyFrontmatterOps(
  app: App,
  file: TFile,
  ops: EditOp[]
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    for (const op of ops) {
      switch (op.kind) {
        case "fm-set":
          fm[op.key] = coerceValue(op.value, op.valueType);
          break;
        case "fm-add":
          if (!(op.key in fm)) fm[op.key] = coerceValue(op.value, op.valueType);
          break;
        case "fm-delete":
          delete fm[op.key];
          break;
        case "fm-list-append": {
          const arr = toStringArray(fm[op.key]);
          if (!arr.includes(op.value)) arr.push(op.value);
          fm[op.key] = arr;
          break;
        }
        case "tag-add": {
          const tag = normTag(op.tag);
          const arr = toStringArray(fm.tags);
          if (tag && !arr.includes(tag)) arr.push(tag);
          fm.tags = arr;
          break;
        }
        case "tag-remove": {
          const tag = normTag(op.tag).toLowerCase();
          const arr = toStringArray(fm.tags).filter(
            (t) => normTag(t).toLowerCase() !== tag
          );
          if (arr.length > 0) fm.tags = arr;
          else delete fm.tags;
          break;
        }
      }
    }
  });
}

/** Builds the pure body transform; throws on invalid regex. Counts replacements. */
export function transformBody(
  app: App,
  file: TFile,
  content: string,
  ops: EditOp[],
  scope: RegexScope,
  counter: { n: number }
): string {
  let out = content;
  for (const op of ops) {
    if (op.kind === "body-regex") {
      const re = safeRegex(op.pattern, op.flags);
      if (!re) throw new Error(`Invalid regex: /${op.pattern}/${op.flags}`);
      const fmEnd = scope === "body" ? frontmatterEnd(app, file, out) : 0;
      const head = out.slice(0, fmEnd);
      const target = out.slice(fmEnd);
      const countRe = safeRegex(op.pattern, ensureGlobal(op.flags));
      const matches = countRe ? target.match(countRe) : null;
      const total = matches ? matches.length : 0;
      counter.n += op.flags.includes("g") ? total : Math.min(1, total);
      out = head + target.replace(re, op.replacement);
    } else if (op.kind === "body-append") {
      const sep = out.endsWith("\n") || out === "" ? "" : "\n";
      out = out + sep + op.text + "\n";
    } else if (op.kind === "body-prepend") {
      const fmEnd = frontmatterEnd(app, file, out);
      const head = out.slice(0, fmEnd);
      const rest = out.slice(fmEnd);
      out = head + op.text + "\n" + rest;
    }
  }
  return out;
}

/** Applies body operations (regex/append/prepend) via the atomic API. */
async function applyBodyOps(
  app: App,
  file: TFile,
  ops: EditOp[],
  scope: RegexScope
): Promise<number> {
  const counter = { n: 0 };
  const transform = (content: string): string =>
    transformBody(app, file, content, ops, scope, counter);

  const vaultAny = app.vault as unknown as {
    process?: (f: TFile, fn: (c: string) => string) => Promise<string>;
  };
  if (typeof vaultAny.process === "function") {
    await vaultAny.process(file, transform);
  } else {
    const content = await app.vault.read(file);
    await app.vault.modify(file, transform(content));
  }
  return counter.n;
}

/**
 * Dry-run pre-flight: simulate all operations without writing, to catch
 * failures (e.g. invalid/failing regex) before touching any file.
 * Returns the files that would fail with their error messages.
 */
export async function preflight(
  app: App,
  files: TFile[],
  ops: EditOp[],
  scope: RegexScope
): Promise<{ path: string; error: string }[]> {
  const bodyOps = orderOps(ops).filter((o) => !FM_KINDS.has(o.kind));
  if (bodyOps.length === 0) return [];
  const failures: { path: string; error: string }[] = [];
  for (const file of files) {
    try {
      const content = await app.vault.cachedRead(file);
      transformBody(app, file, content, bodyOps, scope, { n: 0 });
    } catch (e) {
      failures.push({
        path: file.path,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return failures;
}

function safeRegex(pattern: string, flags: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

const FM_KINDS = new Set<EditOp["kind"]>([
  "fm-set",
  "fm-add",
  "fm-delete",
  "fm-list-append",
  "tag-add",
  "tag-remove",
]);

/** Applies all operations to one file in fixed order, isolating errors. */
export async function applyToFile(
  app: App,
  file: TFile,
  ops: EditOp[],
  scope: RegexScope
): Promise<ApplyResult> {
  const ordered = orderOps(ops);
  const fmOps = ordered.filter((o) => FM_KINDS.has(o.kind));
  const bodyOps = ordered.filter((o) => !FM_KINDS.has(o.kind));
  let regexReplacements = 0;

  try {
    if (fmOps.length > 0) await applyFrontmatterOps(app, file, fmOps);
    if (bodyOps.length > 0)
      regexReplacements = await applyBodyOps(app, file, bodyOps, scope);
    return { path: file.path, ok: true, regexReplacements, changed: true };
  } catch (e) {
    return {
      path: file.path,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      regexReplacements,
      changed: false,
    };
  }
}
