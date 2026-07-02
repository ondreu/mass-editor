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

// ---------- Kleene logika ----------

test("andTri: false dominuje, jinak unknown, jinak true", () => {
  assert.equal(andTri([true, false, "unknown"]), false);
  assert.equal(andTri([true, "unknown"]), "unknown");
  assert.equal(andTri([true, true]), true);
});

test("orTri: true dominuje, jinak unknown, jinak false", () => {
  assert.equal(orTri([false, true, "unknown"]), true);
  assert.equal(orTri([false, "unknown"]), "unknown");
  assert.equal(orTri([false, false]), false);
});

test("notTri: unknown zůstává", () => {
  assert.equal(notTri("unknown"), "unknown");
  assert.equal(notTri(true), false);
  assert.equal(notTri(false), true);
});

// ---------- glob & folder ----------

test("globToRegExp: project/* matchuje jen jednu úroveň", () => {
  const re = globToRegExp("project/*");
  assert.ok(re.test("project/alpha"));
  assert.ok(!re.test("project/alpha/beta"));
});

test("globToRegExp: ** matchuje více úrovní", () => {
  const re = globToRegExp("project/**");
  assert.ok(re.test("project/a/b/c"));
});

test("matchFolder: rekurze zap/vyp", () => {
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

test("frontmatter gt s nekompatibilním typem vrací false", () => {
  const c = ctx({ frontmatter: { status: "todo" } });
  assert.equal(
    evalRule(rule({ field: "frontmatter", key: "status", op: "gt", value: "3" }), c),
    false
  );
});

test("negate prohodí výsledek, unknown ne", () => {
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

test("body vrací unknown dokud není načteno tělo", () => {
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

// ---------- akceptační scénář: (tag AND fm) OR name ----------

test("scénář: (tag has project/* AND fm.status=todo) OR name contains TODO", () => {
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

  // vyhoví přes tag+fm
  assert.equal(
    evalGroup(query, ctx({ tags: ["project/x"], frontmatter: { status: "todo" } })),
    true
  );
  // vyhoví přes název
  assert.equal(
    evalGroup(query, ctx({ name: "My TODO list", tags: [], frontmatter: {} })),
    true
  );
  // nevyhoví
  assert.equal(
    evalGroup(query, ctx({ name: "Random", tags: ["other"], frontmatter: {} })),
    false
  );
});

// ---------- editační pořadí ----------

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

test("coerceValue: typy", () => {
  assert.equal(coerceValue("42", "number"), 42);
  assert.equal(coerceValue("true", "boolean"), true);
  assert.deepEqual(coerceValue("a, b ,c", "list"), ["a", "b", "c"]);
  assert.equal(coerceValue("hi", "string"), "hi");
});
