import type { FieldType, Rule, Tri } from "./types";

/** Context for evaluating a single rule against a single file. */
export interface EvalContext {
  name: string; // basename without extension
  path: string;
  ctime: number; // ms
  mtime: number; // ms
  /** Merged tags (frontmatter + inline) without the leading '#'. */
  tags: string[];
  frontmatter: Record<string, unknown> | undefined;
  /** File body (after the frontmatter). `null` = not read yet (phase 1). */
  body: string | null;
}

/** Typ vstupu hodnoty pro UI. */
export type ValueInput =
  | "none"
  | "text"
  | "number"
  | "date"
  | "glob"
  | "folder"
  | "daterange";

export interface OperatorDef {
  op: string;
  label: string;
  input: ValueInput;
}

/** Operators available per field (order = order in the UI). */
export const OPERATORS: Record<FieldType, OperatorDef[]> = {
  tag: [
    { op: "has", label: "has", input: "text" },
    { op: "hasNot", label: "has not", input: "text" },
    { op: "matchesGlob", label: "matches glob", input: "glob" },
  ],
  frontmatter: [
    { op: "exists", label: "exists", input: "none" },
    { op: "notExists", label: "does not exist", input: "none" },
    { op: "equals", label: "equals", input: "text" },
    { op: "contains", label: "contains", input: "text" },
    { op: "regex", label: "matches regex", input: "text" },
    { op: "gt", label: "greater than", input: "text" },
    { op: "lt", label: "less than", input: "text" },
    { op: "gte", label: "greater or equal", input: "text" },
    { op: "lte", label: "less or equal", input: "text" },
    { op: "isEmpty", label: "is empty", input: "none" },
  ],
  body: [
    { op: "contains", label: "contains", input: "text" },
    { op: "regex", label: "matches regex", input: "text" },
  ],
  name: [
    { op: "contains", label: "contains", input: "text" },
    { op: "equals", label: "equals", input: "text" },
    { op: "regex", label: "matches regex", input: "text" },
  ],
  path: [
    { op: "contains", label: "contains", input: "text" },
    { op: "regex", label: "matches regex", input: "text" },
  ],
  location: [
    { op: "inFolder", label: "in folder", input: "folder" },
    { op: "notInFolder", label: "not in folder", input: "folder" },
  ],
  created: [
    { op: "before", label: "before", input: "date" },
    { op: "after", label: "after", input: "date" },
    { op: "between", label: "between", input: "daterange" },
  ],
  modified: [
    { op: "before", label: "before", input: "date" },
    { op: "after", label: "after", input: "date" },
    { op: "between", label: "between", input: "daterange" },
  ],
};

export function defaultOpFor(field: FieldType): string {
  return OPERATORS[field][0].op;
}

export function inputTypeFor(field: FieldType, op: string): ValueInput {
  const def = OPERATORS[field]?.find((o) => o.op === op);
  return def ? def.input : "text";
}

// ---------- helpers ----------

/** Converts a glob (`project/*`, `a/**`) to a RegExp. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function toTime(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const t = Date.parse(v.trim());
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** Compares two values as numbers, falling back to dates. `null` = incomparable. */
function compare(a: unknown, b: unknown): number | null {
  const an = toNumber(a);
  const bn = toNumber(b);
  if (an !== null && bn !== null) return an - bn;
  const at = toTime(a);
  const bt = toTime(b);
  if (at !== null && bt !== null) return at - bt;
  return null;
}

function safeRegex(pattern: string, flags = ""): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function normTag(t: string): string {
  return t.replace(/^#/, "").toLowerCase();
}

function stringOf(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return String(v);
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

// ---------- single-rule evaluation ----------

/**
 * Evaluates a rule against the context, returning a three-valued result.
 * Content rules (`body`) return `unknown` when the body hasn't been read yet.
 */
export function evalRule(rule: Rule, ctx: EvalContext): Tri {
  const raw = evalRuleInner(rule, ctx);
  if (raw === "unknown") return "unknown";
  return rule.negate ? !raw : raw;
}

function evalRuleInner(rule: Rule, ctx: EvalContext): Tri {
  const val = rule.value;

  switch (rule.field) {
    case "tag": {
      const target = normTag(stringOf(val));
      if (rule.op === "matchesGlob") {
        if (!target) return false;
        const re = globToRegExp(target);
        return ctx.tags.some((t) => re.test(t));
      }
      const has = target !== "" && ctx.tags.includes(target);
      if (rule.op === "has") return has;
      if (rule.op === "hasNot") return !has;
      return false;
    }

    case "frontmatter": {
      const fm = ctx.frontmatter;
      const key = rule.key ?? "";
      const present = fm !== undefined && key !== "" && key in fm;
      const fv = present ? fm[key] : undefined;
      switch (rule.op) {
        case "exists":
          return present;
        case "notExists":
          return !present;
        case "isEmpty":
          return present ? isEmptyValue(fv) : true;
        case "equals": {
          if (!present) return false;
          if (Array.isArray(fv)) return fv.map(stringOf).includes(stringOf(val));
          return stringOf(fv) === stringOf(val);
        }
        case "contains": {
          if (!present) return false;
          if (Array.isArray(fv))
            return fv.map((x) => stringOf(x).toLowerCase()).some((s) =>
              s.includes(stringOf(val).toLowerCase())
            );
          return stringOf(fv).toLowerCase().includes(stringOf(val).toLowerCase());
        }
        case "regex": {
          if (!present) return false;
          const re = safeRegex(stringOf(val));
          if (!re) return false;
          if (Array.isArray(fv)) return fv.some((x) => re.test(stringOf(x)));
          return re.test(stringOf(fv));
        }
        case "gt":
        case "lt":
        case "gte":
        case "lte": {
          if (!present) return false;
          const c = compare(fv, val);
          if (c === null) return false;
          if (rule.op === "gt") return c > 0;
          if (rule.op === "lt") return c < 0;
          if (rule.op === "gte") return c >= 0;
          return c <= 0;
        }
        default:
          return false;
      }
    }

    case "name":
    case "path": {
      const subject = rule.field === "name" ? ctx.name : ctx.path;
      const s = stringOf(val);
      switch (rule.op) {
        case "contains":
          return subject.toLowerCase().includes(s.toLowerCase());
        case "equals":
          return subject === s;
        case "regex": {
          const re = safeRegex(s);
          return re ? re.test(subject) : false;
        }
        default:
          return false;
      }
    }

    case "location": {
      const folder = stringOf(val).replace(/^\/+|\/+$/g, "");
      const includeSub = rule.flag !== false; // default: include subfolders
      const inFolder = matchFolder(ctx.path, folder, includeSub);
      if (rule.op === "inFolder") return inFolder;
      if (rule.op === "notInFolder") return !inFolder;
      return false;
    }

    case "created":
    case "modified": {
      const t = rule.field === "created" ? ctx.ctime : ctx.mtime;
      const a = toTime(val);
      if (rule.op === "before") return a === null ? false : t < a;
      if (rule.op === "after") return a === null ? false : t > a;
      if (rule.op === "between") {
        const b = toTime(rule.value2);
        if (a === null || b === null) return false;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        return t >= lo && t <= hi;
      }
      return false;
    }

    case "body": {
      if (ctx.body === null) return "unknown";
      const s = stringOf(val);
      if (rule.op === "contains")
        return ctx.body.toLowerCase().includes(s.toLowerCase());
      if (rule.op === "regex") {
        const re = safeRegex(s, "m");
        return re ? re.test(ctx.body) : false;
      }
      return false;
    }

    default:
      return false;
  }
}

/** Decides whether `path` lives inside `folder`. */
export function matchFolder(
  path: string,
  folder: string,
  includeSub: boolean
): boolean {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  if (folder === "" || folder === "/") {
    // vault root
    return includeSub ? true : dir === "";
  }
  if (includeSub) {
    return dir === folder || dir.startsWith(folder + "/");
  }
  return dir === folder;
}
