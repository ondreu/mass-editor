import {
  buildHunks,
  diffLines,
  diffStats,
  diffTokens,
  hunkHeader,
  type DiffLine,
  type DiffStats,
  type Hunk,
} from "../edit/diff";

export interface DiffRenderOptions {
  /** Two-column side-by-side layout instead of unified. */
  split?: boolean;
  context?: number;
}

type Side = "del" | "add";

/**
 * Renders a git-style diff of `before` vs `after` into `container`. Supports
 * unified and side-by-side layouts, with word-level highlighting of the parts
 * that actually changed within a replaced line. Returns +/- stats.
 */
export function renderDiff(
  container: HTMLElement,
  before: string,
  after: string,
  opts: DiffRenderOptions = {}
): DiffStats {
  const lines = diffLines(before, after);
  const stats = diffStats(lines);
  const hunks = buildHunks(lines, opts.context ?? 3);

  container.empty();
  container.addClass("me-diff");
  container.toggleClass("is-split", !!opts.split);
  if (hunks.length === 0) return stats;

  for (const hunk of hunks) {
    if (opts.split) renderSplitHunk(container, hunk);
    else renderUnifiedHunk(container, hunk);
  }
  return stats;
}

function markerFor(op: DiffLine["op"]): string {
  return op === "add" ? "+" : op === "del" ? "-" : " ";
}

/** Fills a text span, optionally highlighting changed word tokens for one side. */
function fillText(
  el: HTMLElement,
  text: string,
  tokens: DiffLine[] | undefined,
  side: Side | undefined
): void {
  if (!tokens || !side) {
    el.setText(text);
    return;
  }
  const skip = side === "del" ? "add" : "del";
  const changed = side; // tokens with this op are the changed ones on this side
  for (const t of tokens) {
    if (t.op === skip) continue;
    if (t.op === changed) {
      el.createSpan({ cls: "me-diff__word", text: t.text });
    } else {
      el.appendText(t.text);
    }
  }
}

function unifiedRow(
  view: HTMLElement,
  op: DiffLine["op"],
  text: string,
  tokens?: DiffLine[],
  side?: Side
): void {
  const cls =
    op === "add"
      ? "me-diff__line is-add"
      : op === "del"
        ? "me-diff__line is-del"
        : "me-diff__line";
  const row = view.createDiv({ cls });
  row.createSpan({ cls: "me-diff__marker", text: markerFor(op) });
  fillText(row.createSpan({ cls: "me-diff__text" }), text, tokens, side);
}

/** Splits a hunk into eq lines and del/add change blocks; pairs equal-size blocks. */
function walkBlocks(
  lines: DiffLine[],
  onEq: (text: string) => void,
  onChange: (dels: string[], adds: string[], pairable: boolean) => void
): void {
  let i = 0;
  while (i < lines.length) {
    if (lines[i].op === "eq") {
      onEq(lines[i].text);
      i++;
      continue;
    }
    const dels: string[] = [];
    while (i < lines.length && lines[i].op === "del") dels.push(lines[i++].text);
    const adds: string[] = [];
    while (i < lines.length && lines[i].op === "add") adds.push(lines[i++].text);
    const pairable = dels.length > 0 && dels.length === adds.length;
    onChange(dels, adds, pairable);
  }
}

function renderUnifiedHunk(view: HTMLElement, h: Hunk): void {
  view.createDiv({ cls: "me-diff__hunk-head", text: hunkHeader(h) });
  walkBlocks(
    h.lines,
    (text) => unifiedRow(view, "eq", text),
    (dels, adds, pairable) => {
      dels.forEach((d, k) =>
        unifiedRow(view, "del", d, pairable ? diffTokens(d, adds[k]) : undefined, "del")
      );
      adds.forEach((a, k) =>
        unifiedRow(view, "add", a, pairable ? diffTokens(dels[k], a) : undefined, "add")
      );
    }
  );
}

function splitCell(
  row: HTMLElement,
  which: "left" | "right",
  op: DiffLine["op"] | "empty",
  text: string,
  tokens?: DiffLine[],
  side?: Side
): void {
  const state =
    op === "add"
      ? " is-add"
      : op === "del"
        ? " is-del"
        : op === "empty"
          ? " is-empty"
          : "";
  const cell = row.createDiv({ cls: `me-diff__cell is-${which}${state}` });
  if (op === "empty") return;
  fillText(cell.createSpan({ cls: "me-diff__text" }), text, tokens, side);
}

function renderSplitHunk(view: HTMLElement, h: Hunk): void {
  view.createDiv({ cls: "me-diff__hunk-head", text: hunkHeader(h) });
  walkBlocks(
    h.lines,
    (text) => {
      const row = view.createDiv({ cls: "me-diff__srow" });
      splitCell(row, "left", "eq", text);
      splitCell(row, "right", "eq", text);
    },
    (dels, adds, pairable) => {
      const rows = Math.max(dels.length, adds.length);
      for (let k = 0; k < rows; k++) {
        const row = view.createDiv({ cls: "me-diff__srow" });
        const d = dels[k];
        const a = adds[k];
        if (d !== undefined)
          splitCell(row, "left", "del", d, pairable ? diffTokens(d, a) : undefined, "del");
        else splitCell(row, "left", "empty", "");
        if (a !== undefined)
          splitCell(row, "right", "add", a, pairable ? diffTokens(d, a) : undefined, "add");
        else splitCell(row, "right", "empty", "");
      }
    }
  );
}
