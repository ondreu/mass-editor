import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLANK_LINE_PRESETS,
  DEFAULT_BLANK_LINE_RULES,
  normalizeBlankLines,
  presetForRules,
  type BlankLineRules,
} from "../src/edit/blanklines";

const rules = (over: Partial<BlankLineRules> = {}): BlankLineRules => ({
  ...DEFAULT_BLANK_LINE_RULES,
  ...over,
});

test("collapses runs to a single blank line by default", () => {
  const out = normalizeBlankLines("a\n\n\n\nb", rules({ maxConsecutive: 1 }));
  assert.equal(out, "a\n\nb");
});

test("maxConsecutive 2 keeps up to two blanks", () => {
  const out = normalizeBlankLines("a\n\n\n\nb", rules({ maxConsecutive: 2 }));
  assert.equal(out, "a\n\n\nb");
});

test("maxConsecutive 0 removes all blank lines", () => {
  const out = normalizeBlankLines("a\n\nb\n\nc", rules({ maxConsecutive: 0 }));
  assert.equal(out, "a\nb\nc");
});

test("does not change already-normalised text", () => {
  const text = "a\n\nb\n\nc\n";
  assert.equal(normalizeBlankLines(text, rules({ maxConsecutive: 1 })), text);
});

test("preserves a trailing newline", () => {
  const out = normalizeBlankLines("a\n\n\nb\n", rules({ maxConsecutive: 1 }));
  assert.equal(out, "a\n\nb\n");
});

test("collapseAfterHeading drops blanks right after a heading", () => {
  const out = normalizeBlankLines(
    "# Title\n\n\ntext",
    rules({ maxConsecutive: 2, collapseAfterHeading: true })
  );
  assert.equal(out, "# Title\ntext");
});

test("collapseBeforeHeading drops blanks right before a heading", () => {
  const out = normalizeBlankLines(
    "text\n\n\n## Next",
    rules({ maxConsecutive: 2, collapseBeforeHeading: true })
  );
  assert.equal(out, "text\n## Next");
});

test("collapseListItems removes blanks between bullets only", () => {
  const out = normalizeBlankLines(
    "- one\n\n- two\n\nparagraph",
    rules({ maxConsecutive: 1, collapseListItems: true })
  );
  assert.equal(out, "- one\n- two\n\nparagraph");
});

test("collapseTasks removes blanks between task items", () => {
  const out = normalizeBlankLines(
    "- [ ] a\n\n- [x] b",
    rules({ maxConsecutive: 1, collapseTasks: true })
  );
  assert.equal(out, "- [ ] a\n- [x] b");
});

test("trimEnds strips leading and trailing blank lines", () => {
  const out = normalizeBlankLines(
    "\n\ntext\n\n",
    rules({ maxConsecutive: 1, trimEnds: true })
  );
  assert.equal(out, "text\n");
});

test("preserves CRLF line endings", () => {
  const out = normalizeBlankLines("a\r\n\r\n\r\nb", rules({ maxConsecutive: 1 }));
  assert.equal(out, "a\r\n\r\nb");
});

test("empty input is unchanged", () => {
  assert.equal(normalizeBlankLines("", rules()), "");
});

test("presetForRules round-trips every preset", () => {
  for (const p of BLANK_LINE_PRESETS) {
    assert.equal(presetForRules(p.rules)?.id, p.id);
  }
});

test("presetForRules returns null for a custom mix", () => {
  assert.equal(
    presetForRules(rules({ maxConsecutive: 3, collapseTasks: true })),
    null
  );
});
