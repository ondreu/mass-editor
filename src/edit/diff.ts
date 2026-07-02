/**
 * Dependency-free, line-based diff (git-style). Used to show what an edit run
 * changed in a note: backup content ("before") vs current content ("after").
 */

export type DiffOp = "eq" | "add" | "del";

export interface DiffLine {
  op: DiffOp;
  text: string;
}

export interface Hunk {
  /** 1-based start line in the "before" text (0 for a pure insertion). */
  beforeStart: number;
  beforeLines: number;
  /** 1-based start line in the "after" text (0 for a pure deletion). */
  afterStart: number;
  afterLines: number;
  lines: DiffLine[];
}

export interface DiffStats {
  added: number;
  removed: number;
}

/** Cap for the O(n·m) LCS table (line count product). Beyond it, fall back. */
const LCS_CELL_CAP = 4_000_000;

function splitLines(text: string): string[] {
  if (text === "") return [];
  // Normalise CRLF so a line-ending change alone doesn't show as a full diff.
  return text.replace(/\r\n/g, "\n").split("\n");
}

/** LCS-based diff of two line arrays (no common-affix trimming). */
function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((text) => ({ op: "add" as const, text }));
  if (m === 0) return a.map((text) => ({ op: "del" as const, text }));
  if (n * m > LCS_CELL_CAP) {
    // Too large to diff cheaply — treat as a full replacement.
    return [
      ...a.map((text) => ({ op: "del" as const, text })),
      ...b.map((text) => ({ op: "add" as const, text })),
    ];
  }

  const dp: Uint32Array[] = Array.from(
    { length: n + 1 },
    () => new Uint32Array(m + 1)
  );
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i];
    const next = dp[i + 1];
    for (let j = m - 1; j >= 0; j--) {
      row[j] =
        a[i] === b[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "eq", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: "del", text: a[i] });
      i++;
    } else {
      out.push({ op: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ op: "del", text: a[i++] });
  while (j < m) out.push({ op: "add", text: b[j++] });
  return out;
}

/** Full line-level diff. Trims common prefix/suffix first for speed. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ op: "eq", text: a[i] });
  out.push(...lcsDiff(a.slice(start, endA), b.slice(start, endB)));
  for (let i = endA; i < a.length; i++) out.push({ op: "eq", text: a[i] });
  return out;
}

export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.op === "add") added++;
    else if (l.op === "del") removed++;
  }
  return { added, removed };
}

/**
 * Groups a full diff into git-style hunks, keeping `context` unchanged lines
 * around each change and collapsing long unchanged runs.
 */
export function buildHunks(lines: DiffLine[], context = 3): Hunk[] {
  const n = lines.length;
  if (n === 0) return [];

  // Line numbers per side (add lines have no "before" number, and vice versa).
  const bNums = new Array<number>(n);
  const aNums = new Array<number>(n);
  let bLine = 1;
  let aLine = 1;
  for (let i = 0; i < n; i++) {
    const op = lines[i].op;
    bNums[i] = op === "add" ? -1 : bLine;
    aNums[i] = op === "del" ? -1 : aLine;
    if (op !== "add") bLine++;
    if (op !== "del") aLine++;
  }

  // Keep any line within `context` of a change.
  const keep = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (lines[i].op === "eq") continue;
    const lo = Math.max(0, i - context);
    const hi = Math.min(n - 1, i + context);
    for (let k = lo; k <= hi; k++) keep[k] = true;
  }

  const hunks: Hunk[] = [];
  let i = 0;
  while (i < n) {
    if (!keep[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && keep[j]) j++;
    const seg = lines.slice(i, j);

    let beforeStart = 0;
    let afterStart = 0;
    let beforeLines = 0;
    let afterLines = 0;
    for (let k = i; k < j; k++) {
      if (lines[k].op !== "add") {
        if (beforeStart === 0) beforeStart = bNums[k];
        beforeLines++;
      }
      if (lines[k].op !== "del") {
        if (afterStart === 0) afterStart = aNums[k];
        afterLines++;
      }
    }
    hunks.push({ beforeStart, beforeLines, afterStart, afterLines, lines: seg });
    i = j;
  }
  return hunks;
}

/** Git-style hunk header, e.g. `@@ -3,4 +3,5 @@`. */
export function hunkHeader(h: Hunk): string {
  return `@@ -${h.beforeStart},${h.beforeLines} +${h.afterStart},${h.afterLines} @@`;
}
