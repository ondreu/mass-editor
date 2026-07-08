import type { BlankLineRules } from "./blanklines";

export type FmValueType = "string" | "number" | "boolean" | "list";

export type FmToBodyPosition = "append" | "prepend";

export type EditOp =
  | { kind: "fm-set"; key: string; value: string; valueType: FmValueType }
  | { kind: "fm-add"; key: string; value: string; valueType: FmValueType } // only if the key is missing
  | { kind: "fm-delete"; key: string }
  | { kind: "fm-list-append"; key: string; value: string } // do YAML listu, bez duplicit
  | {
      kind: "fm-to-body";
      key: string;
      position: FmToBodyPosition;
      template: string; // {{key}} / {{value}} placeholders
      removeKey: boolean;
    }
  | { kind: "tag-add"; tag: string } // frontmatter tags[]
  | { kind: "tag-remove"; tag: string }
  | { kind: "body-regex"; pattern: string; flags: string; replacement: string }
  | { kind: "body-append"; text: string }
  | { kind: "body-prepend"; text: string }
  | { kind: "body-blank-lines"; rules: BlankLineRules };

export const OP_LABELS: Record<EditOp["kind"], string> = {
  "fm-set": "Set frontmatter key",
  "fm-add": "Add frontmatter key (only if missing)",
  "fm-delete": "Delete frontmatter key",
  "fm-list-append": "Append to frontmatter list",
  "fm-to-body": "Move frontmatter key to body",
  "tag-add": "Add tag",
  "tag-remove": "Remove tag",
  "body-regex": "Regex find & replace (body)",
  "body-append": "Append to body",
  "body-prepend": "Prepend to body",
  "body-blank-lines": "Remove duplicate blank lines",
};

/**
 * Fixed per-file application order. Lower number = earlier.
 * 1) frontmatter, 2) tags, 3) move-to-body, 4) regex, 5) append/prepend,
 * 6) blank-line cleanup (last, so it tidies text other ops introduced).
 */
export function opOrder(kind: EditOp["kind"]): number {
  switch (kind) {
    case "fm-set":
    case "fm-add":
    case "fm-delete":
    case "fm-list-append":
      return 1;
    case "tag-add":
    case "tag-remove":
      return 2;
    case "fm-to-body":
      return 3;
    case "body-regex":
      return 4;
    case "body-append":
    case "body-prepend":
      return 5;
    case "body-blank-lines":
      return 6;
  }
}

/** Sorts operations into deterministic order (stable). */
export function orderOps(ops: EditOp[]): EditOp[] {
  return ops
    .map((op, i) => ({ op, i }))
    .sort((a, b) => opOrder(a.op.kind) - opOrder(b.op.kind) || a.i - b.i)
    .map((x) => x.op);
}

/** Converts a text value into a typed frontmatter value. */
export function coerceValue(value: string, type: FmValueType): unknown {
  switch (type) {
    case "number": {
      const n = Number(value);
      return Number.isNaN(n) ? value : n;
    }
    case "boolean":
      return value.trim().toLowerCase() === "true";
    case "list":
      return value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    case "string":
    default:
      return value;
  }
}

/** Checks whether an operation is fully filled in (for UI validation). */
export function isOpValid(op: EditOp): boolean {
  switch (op.kind) {
    case "fm-set":
    case "fm-add":
      return op.key.trim() !== "";
    case "fm-delete":
    case "fm-list-append":
      return op.key.trim() !== "";
    case "fm-to-body":
      return op.key.trim() !== "" && op.template.trim() !== "";
    case "tag-add":
    case "tag-remove":
      return op.tag.trim() !== "";
    case "body-regex":
      return op.pattern.trim() !== "";
    case "body-append":
    case "body-prepend":
      return op.text !== "";
    case "body-blank-lines":
      return true;
  }
}
