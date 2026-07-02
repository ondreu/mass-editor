import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildHunks,
  diffLines,
  diffStats,
  hunkHeader,
} from "../src/edit/diff";

test("diffLines: identical text yields all eq, no changes", () => {
  const lines = diffLines("a\nb\nc", "a\nb\nc");
  assert.ok(lines.every((l) => l.op === "eq"));
  assert.deepEqual(diffStats(lines), { added: 0, removed: 0 });
});

test("diffLines: pure addition", () => {
  const lines = diffLines("a\nc", "a\nb\nc");
  assert.deepEqual(diffStats(lines), { added: 1, removed: 0 });
  assert.deepEqual(
    lines.map((l) => `${l.op}:${l.text}`),
    ["eq:a", "add:b", "eq:c"]
  );
});

test("diffLines: pure deletion", () => {
  const lines = diffLines("a\nb\nc", "a\nc");
  assert.deepEqual(diffStats(lines), { added: 0, removed: 1 });
});

test("diffLines: replacement is del + add", () => {
  const lines = diffLines("hello\nworld", "hello\nthere");
  assert.deepEqual(diffStats(lines), { added: 1, removed: 1 });
});

test("diffLines: empty before is all additions", () => {
  const lines = diffLines("", "x\ny");
  assert.deepEqual(diffStats(lines), { added: 2, removed: 0 });
});

test("diffLines: CRLF vs LF is not a change", () => {
  const lines = diffLines("a\r\nb", "a\nb");
  assert.deepEqual(diffStats(lines), { added: 0, removed: 0 });
});

test("buildHunks: collapses unchanged runs, keeps context", () => {
  const before = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
  const after = before.replace("line10", "LINE10");
  const hunks = buildHunks(diffLines(before, after), 3);
  assert.equal(hunks.length, 1);
  // 3 context + change + 3 context on each side; change is del+add.
  const texts = hunks[0].lines.map((l) => l.text);
  assert.ok(texts.includes("line7"));
  assert.ok(texts.includes("line13"));
  assert.ok(!texts.includes("line0"));
});

test("hunkHeader: git-style ranges", () => {
  const hunks = buildHunks(diffLines("a\nc", "a\nb\nc"), 3);
  assert.equal(hunks.length, 1);
  assert.equal(hunkHeader(hunks[0]), "@@ -1,2 +1,3 @@");
});
