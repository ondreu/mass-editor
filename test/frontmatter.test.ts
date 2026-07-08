import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FM_TO_BODY_PRESETS,
  fmValueToString,
  presetForTemplate,
  renderFmTemplate,
} from "../src/edit/frontmatter";

test("fmValueToString: scalars", () => {
  assert.equal(fmValueToString("hello"), "hello");
  assert.equal(fmValueToString(42), "42");
  assert.equal(fmValueToString(true), "true");
});

test("fmValueToString: null / undefined become empty", () => {
  assert.equal(fmValueToString(null), "");
  assert.equal(fmValueToString(undefined), "");
});

test("fmValueToString: lists join with comma", () => {
  assert.equal(fmValueToString(["a", "b", "c"]), "a, b, c");
  assert.equal(fmValueToString([1, 2]), "1, 2");
});

test("fmValueToString: objects fall back to JSON", () => {
  assert.equal(fmValueToString({ a: 1 }), '{"a":1}');
});

test("renderFmTemplate: fills key and value", () => {
  assert.equal(
    renderFmTemplate("**{{key}}:** {{value}}", "status", "done"),
    "**status:** done"
  );
});

test("renderFmTemplate: tolerates whitespace and repeats", () => {
  assert.equal(
    renderFmTemplate("{{ key }}: {{value}} / {{value}}", "k", "v"),
    "k: v / v"
  );
});

test("renderFmTemplate: heading preset with list value", () => {
  assert.equal(
    renderFmTemplate("## {{key}}\n\n{{value}}", "tags", ["x", "y"]),
    "## tags\n\nx, y"
  );
});

test("presetForTemplate: matches a known preset and null otherwise", () => {
  const heading = FM_TO_BODY_PRESETS.find((p) => p.id === "heading")!;
  assert.equal(presetForTemplate(heading.template)?.id, "heading");
  assert.equal(presetForTemplate("totally custom {{value}}"), null);
});
