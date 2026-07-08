import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type FmVarContext,
  FM_VARIABLES,
  formatDate,
  renderFmValue,
} from "../src/edit/variables";

// A fixed context. Times are chosen so local formatting is unambiguous at noon.
const ctx: FmVarContext = {
  basename: "My Note",
  path: "Projects/My Note.md",
  folder: "Projects",
  ctime: new Date(2024, 0, 2, 12, 0, 0).getTime(), // 2024-01-02 12:00 local
  mtime: new Date(2025, 10, 9, 8, 5, 3).getTime(), // 2025-11-09 08:05:03 local
  now: new Date(2026, 6, 8, 15, 30, 0).getTime(), // 2026-07-08 15:30 local
};

test("formatDate: token substitution (local time)", () => {
  const ms = new Date(2025, 10, 9, 8, 5, 3).getTime();
  assert.equal(formatDate(ms, "YYYY-MM-DD"), "2025-11-09");
  assert.equal(formatDate(ms, "YYYY/MM/DD HH:mm:ss"), "2025/11/09 08:05:03");
  assert.equal(formatDate(ms, "YY"), "25");
});

test("renderFmValue: note name / path / folder", () => {
  assert.equal(renderFmValue("{{title}}", ctx), "My Note");
  assert.equal(renderFmValue("{{name}}", ctx), "My Note");
  assert.equal(renderFmValue("{{path}}", ctx), "Projects/My Note.md");
  assert.equal(renderFmValue("{{folder}}", ctx), "Projects");
});

test("renderFmValue: dates with default formats", () => {
  assert.equal(renderFmValue("{{today}}", ctx), "2026-07-08");
  assert.equal(renderFmValue("{{created}}", ctx), "2024-01-02");
  assert.equal(renderFmValue("{{modified}}", ctx), "2025-11-09");
  assert.equal(renderFmValue("{{now}}", ctx), "2026-07-08 15:30");
});

test("renderFmValue: custom date format via :suffix", () => {
  assert.equal(renderFmValue("{{modified:YYYY/MM/DD}}", ctx), "2025/11/09");
  assert.equal(renderFmValue("{{created:HH:mm}}", ctx), "12:00");
});

test("renderFmValue: whitespace tolerance and mixed text", () => {
  assert.equal(
    renderFmValue("Updated {{ modified }} by hand", ctx),
    "Updated 2025-11-09 by hand"
  );
});

test("renderFmValue: unknown placeholders are left untouched", () => {
  assert.equal(renderFmValue("{{bogus}}", ctx), "{{bogus}}");
  assert.equal(renderFmValue("plain text", ctx), "plain text");
});

test("FM_VARIABLES: every menu entry resolves to something", () => {
  for (const v of FM_VARIABLES) {
    const out = renderFmValue(v.insert, ctx);
    assert.notEqual(out, v.insert, `${v.insert} did not resolve`);
  }
});
