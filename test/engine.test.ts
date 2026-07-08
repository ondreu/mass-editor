import { test } from "node:test";
import assert from "node:assert/strict";
import { andTri, orTri, notTri, evalGroup } from "../src/query/evaluate";
import {
  evalRule,
  globToRegExp,
  matchFolder,
  type EvalContext,
} from "../src/query/operators";
import type { Group, Rule } from "../src/query/types";
import { orderOps, coerceValue } from "../src/edit/operations";
import type { EditOp } from "../src/edit/operations";
import { transformBody } from "../src/edit/applier";

// Minimal fakes: no frontmatter cache → frontmatter offset is 0.
const fakeApp = { metadataCache: { getFileCache: () => null } } as never;
const fakeFile = {} as never;

function ctx(over: Partial<EvalContext> = {}): EvalContext {
  return {
    name: "Note",
    path: "folder/Note.md",
    ctime: Date.parse("2026-01-01"),
    mtime: Date.parse("2026-06-01"),
    tags: [],
    frontmatter: undefined,
    body: null,
    ...over,
  };
}

function rule(over: Partial<Rule>): Rule {
  return { id: "r", field: "tag", op: "has", ...over } as Rule;
}

// ---------- Kleene logic ----------

test("andTri: false dominates, else unknown, else true", () => {
  assert.equal(andTri([true, false, "unknown"]), false);
  assert.equal(andTri([true, "unknown"]), "unknown");
  assert.equal(andTri([true, true]), true);
});

test("orTri: true dominates, else unknown, else false", () => {
  assert.equal(orTri([false, true, "unknown"]), true);
  assert.equal(orTri([false, "unknown"]), "unknown");
  assert.equal(orTri([false, false]), false);
});

test("notTri: unknown stays unknown", () => {
  assert.equal(notTri("unknown"), "unknown");
  assert.equal(notTri(true), false);
  assert.equal(notTri(false), true);
});

// ---------- glob & folder ----------

test("globToRegExp: project/* matches a single level only", () => {
  const re = globToRegExp("project/*");
  assert.ok(re.test("project/alpha"));
  assert.ok(!re.test("project/alpha/beta"));
});

test("globToRegExp: ** matches multiple levels", () => {
  const re = globToRegExp("project/**");
  assert.ok(re.test("project/a/b/c"));
});

test("matchFolder: recursion on/off", () => {
  assert.ok(matchFolder("a/b/note.md", "a", true));
  assert.ok(!matchFolder("a/b/note.md", "a", false));
  assert.ok(matchFolder("a/note.md", "a", false));
});

// ---------- evalRule ----------

test("tag has / hasNot", () => {
  const c = ctx({ tags: ["project/x", "todo"] });
  assert.equal(evalRule(rule({ field: "tag", op: "has", value: "todo" }), c), true);
  assert.equal(
    evalRule(rule({ field: "tag", op: "hasNot", value: "done" }), c),
    true
  );
});

test("tag matchesGlob project/*", () => {
  const c = ctx({ tags: ["project/x"] });
  assert.equal(
    evalRule(rule({ field: "tag", op: "matchesGlob", value: "project/*" }), c),
    true
  );
});

test("frontmatter equals / gt", () => {
  const c = ctx({ frontmatter: { status: "todo", prio: 5 } });
  assert.equal(
    evalRule(rule({ field: "frontmatter", key: "status", op: "equals", value: "todo" }), c),
    true
  );
  assert.equal(
    evalRule(rule({ field: "frontmatter", key: "prio", op: "gt", value: "3" }), c),
    true
  );
});

test("frontmatter gt with incompatible type returns false", () => {
  const c = ctx({ frontmatter: { status: "todo" } });
  assert.equal(
    evalRule(rule({ field: "frontmatter", key: "status", op: "gt", value: "3" }), c),
    false
  );
});

test("negate flips the result, but not unknown", () => {
  const c = ctx({ tags: ["a"] });
  assert.equal(
    evalRule(rule({ field: "tag", op: "has", value: "a", negate: true }), c),
    false
  );
  const cb = ctx({ body: null });
  assert.equal(
    evalRule(rule({ field: "body", op: "contains", value: "x", negate: true }), cb),
    "unknown"
  );
});

test("body returns unknown until the body is read", () => {
  assert.equal(
    evalRule(rule({ field: "body", op: "contains", value: "foo" }), ctx({ body: null })),
    "unknown"
  );
  assert.equal(
    evalRule(
      rule({ field: "body", op: "contains", value: "foo" }),
      ctx({ body: "a foo b" })
    ),
    true
  );
});

// ---------- acceptance scenario: (tag AND fm) OR name ----------

test("scenario: (tag has project/* AND fm.status=todo) OR name contains TODO", () => {
  const query: Group = {
    id: "root",
    logic: "OR",
    children: [
      {
        id: "g1",
        logic: "AND",
        children: [
          rule({ field: "tag", op: "matchesGlob", value: "project/*" }),
          rule({ field: "frontmatter", key: "status", op: "equals", value: "todo" }),
        ],
      },
      rule({ field: "name", op: "contains", value: "TODO" }),
    ],
  };

  // matches via tag+fm
  assert.equal(
    evalGroup(query, ctx({ tags: ["project/x"], frontmatter: { status: "todo" } })),
    true
  );
  // matches via name
  assert.equal(
    evalGroup(query, ctx({ name: "My TODO list", tags: [], frontmatter: {} })),
    true
  );
  // no match
  assert.equal(
    evalGroup(query, ctx({ name: "Random", tags: ["other"], frontmatter: {} })),
    false
  );
});

// ---------- edit ordering ----------

test("orderOps: fm → tag → regex → append/prepend", () => {
  const ops: EditOp[] = [
    { kind: "body-append", text: "x" },
    { kind: "tag-add", tag: "t" },
    { kind: "fm-set", key: "k", value: "v", valueType: "string" },
    { kind: "body-regex", pattern: "a", flags: "g", replacement: "b" },
  ];
  const kinds = orderOps(ops).map((o) => o.kind);
  assert.deepEqual(kinds, ["fm-set", "tag-add", "body-regex", "body-append"]);
});

// ---------- body transform (dry-run / apply core) ----------

test("transformBody: append adds a trailing line", () => {
  const c = { n: 0 };
  const out = transformBody(fakeApp, fakeFile, "hello", [
    { kind: "body-append", text: "X" },
  ], "body", c);
  assert.equal(out, "hello\nX\n");
});

test("transformBody: prepend inserts before body (no frontmatter)", () => {
  const c = { n: 0 };
  const out = transformBody(fakeApp, fakeFile, "hello", [
    { kind: "body-prepend", text: "X" },
  ], "body", c);
  assert.equal(out, "X\nhello");
});

test("transformBody: prepend inserts after frontmatter, not before it", () => {
  const c = { n: 0 };
  const content = "---\ntitle: x\n---\nhello";
  const out = transformBody(fakeApp, fakeFile, content, [
    { kind: "body-prepend", text: "X" },
  ], "body", c);
  assert.equal(out, "---\ntitle: x\n---\nX\nhello");
});

test("transformBody: fm-to-body prepend inserts after frontmatter", () => {
  const c = { n: 0 };
  const content = "---\ntitle: x\n---\nhello";
  const captures = new Map();
  const op = {
    kind: "fm-to-body",
    key: "title",
    position: "prepend",
    template: "{{value}}",
    removeKey: false,
  } as const;
  captures.set(op, "x");
  const out = transformBody(fakeApp, fakeFile, content, [op], "body", c, captures);
  assert.equal(out, "---\ntitle: x\n---\nx\nhello");
});

test("transformBody: regex replaces and counts matches", () => {
  const c = { n: 0 };
  const out = transformBody(fakeApp, fakeFile, "foo foo bar", [
    { kind: "body-regex", pattern: "foo", flags: "g", replacement: "baz" },
  ], "whole", c);
  assert.equal(out, "baz baz bar");
  assert.equal(c.n, 2);
});

test("transformBody: invalid regex throws (caught by preflight)", () => {
  assert.throws(() =>
    transformBody(fakeApp, fakeFile, "x", [
      { kind: "body-regex", pattern: "(", flags: "", replacement: "" },
    ], "whole", { n: 0 })
  );
});

test("coerceValue: types", () => {
  assert.equal(coerceValue("42", "number"), 42);
  assert.equal(coerceValue("true", "boolean"), true);
  assert.deepEqual(coerceValue("a, b ,c", "list"), ["a", "b", "c"]);
  assert.equal(coerceValue("hi", "string"), "hi");
});
