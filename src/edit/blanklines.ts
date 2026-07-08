/**
 * Blank-line normalisation: collapse runs of duplicated empty lines, and
 * optionally strip blanks in structural spots (after/before headings, between
 * list items or tasks). Presets bundle common rule combinations; custom rules
 * are just an arbitrary {@link BlankLineRules} object.
 */

export interface BlankLineRules {
  /** Max consecutive blank lines kept anywhere (0 removes all blanks). */
  maxConsecutive: number;
  /** Drop blank lines directly after a heading. */
  collapseAfterHeading: boolean;
  /** Drop blank lines directly before a heading. */
  collapseBeforeHeading: boolean;
  /** Drop blank lines between consecutive list items (bullets / ordered). */
  collapseListItems: boolean;
  /** Drop blank lines between consecutive task items. */
  collapseTasks: boolean;
  /** Trim leading and trailing blank lines. */
  trimEnds: boolean;
}

export interface BlankLinePreset {
  id: string;
  label: string;
  rules: BlankLineRules;
}

export const DEFAULT_BLANK_LINE_RULES: BlankLineRules = {
  maxConsecutive: 1,
  collapseAfterHeading: false,
  collapseBeforeHeading: false,
  collapseListItems: false,
  collapseTasks: false,
  trimEnds: false,
};

export const BLANK_LINE_PRESETS: BlankLinePreset[] = [
  {
    id: "single",
    label: "Collapse to a single blank line",
    rules: { ...DEFAULT_BLANK_LINE_RULES, maxConsecutive: 1 },
  },
  {
    id: "tight-lists",
    label: "Tighten lists & tasks (+ collapse)",
    rules: {
      maxConsecutive: 1,
      collapseAfterHeading: false,
      collapseBeforeHeading: false,
      collapseListItems: true,
      collapseTasks: true,
      trimEnds: false,
    },
  },
  {
    id: "headings",
    label: "Hug headings (+ collapse)",
    rules: {
      maxConsecutive: 1,
      collapseAfterHeading: true,
      collapseBeforeHeading: true,
      collapseListItems: false,
      collapseTasks: false,
      trimEnds: false,
    },
  },
  {
    id: "compact",
    label: "Compact — all rules",
    rules: {
      maxConsecutive: 1,
      collapseAfterHeading: true,
      collapseBeforeHeading: true,
      collapseListItems: true,
      collapseTasks: true,
      trimEnds: true,
    },
  },
];

/** Finds the preset matching a rule set, or null for custom rules. */
export function presetForRules(rules: BlankLineRules): BlankLinePreset | null {
  return (
    BLANK_LINE_PRESETS.find(
      (p) =>
        p.rules.maxConsecutive === rules.maxConsecutive &&
        p.rules.collapseAfterHeading === rules.collapseAfterHeading &&
        p.rules.collapseBeforeHeading === rules.collapseBeforeHeading &&
        p.rules.collapseListItems === rules.collapseListItems &&
        p.rules.collapseTasks === rules.collapseTasks &&
        p.rules.trimEnds === rules.trimEnds
    ) ?? null
  );
}

const isBlank = (line: string): boolean => line.trim() === "";
const isHeading = (line: string): boolean => /^ {0,3}#{1,6}(\s|$)/.test(line);
const isListItem = (line: string): boolean =>
  /^\s*([-*+]|\d+[.)])\s+/.test(line);
const isTask = (line: string): boolean => /^\s*[-*+]\s+\[.\]\s?/.test(line);

/**
 * Normalises blank lines in `text` according to `rules`. Line endings and a
 * trailing newline are preserved; only empty lines between content are touched.
 */
export function normalizeBlankLines(text: string, rules: BlankLineRules): string {
  if (text === "") return text;
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const endsWithNL = /\r?\n$/.test(text);
  const lines = text.split(/\r?\n/);
  if (endsWithNL) lines.pop(); // drop the empty element the final newline creates

  const maxKeep = Math.max(0, Math.floor(rules.maxConsecutive));
  const out: string[] = [];
  const n = lines.length;
  let i = 0;
  while (i < n) {
    if (!isBlank(lines[i])) {
      out.push(lines[i]);
      i++;
      continue;
    }
    // Consume a run of blank lines [i, j).
    let j = i;
    while (j < n && isBlank(lines[j])) j++;
    const runLen = j - i;
    const prev = i > 0 ? lines[i - 1] : null;
    const next = j < n ? lines[j] : null;

    let keep = Math.min(runLen, maxKeep);
    if (prev === null || next === null) {
      if (rules.trimEnds) keep = 0;
    } else {
      if (rules.collapseAfterHeading && isHeading(prev)) keep = 0;
      if (rules.collapseBeforeHeading && isHeading(next)) keep = 0;
      if (rules.collapseListItems && isListItem(prev) && isListItem(next))
        keep = 0;
      if (rules.collapseTasks && isTask(prev) && isTask(next)) keep = 0;
    }
    for (let k = 0; k < keep; k++) out.push("");
    i = j;
  }

  let result = out.join(eol);
  if (endsWithNL && result !== "") result += eol;
  return result;
}
