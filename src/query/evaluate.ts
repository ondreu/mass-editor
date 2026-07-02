import {
  type Group,
  type Node,
  type Rule,
  type Tri,
  isGroup,
  isContentField,
} from "./types";
import { type EvalContext, evalRule } from "./operators";

// ---------- Kleene (tří-hodnotová) logika ----------

export function andTri(values: Tri[]): Tri {
  if (values.some((v) => v === false)) return false;
  if (values.some((v) => v === "unknown")) return "unknown";
  return true;
}

export function orTri(values: Tri[]): Tri {
  if (values.some((v) => v === true)) return true;
  if (values.some((v) => v === "unknown")) return "unknown";
  return false;
}

export function notTri(v: Tri): Tri {
  if (v === "unknown") return "unknown";
  return !v;
}

// ---------- vyhodnocení stromu ----------

export function evalGroup(group: Group, ctx: EvalContext): Tri {
  if (group.children.length === 0) {
    // prázdná skupina = neutrální (vše projde)
    return true;
  }
  const results = group.children.map((child) => evalNode(child, ctx));
  const combined = group.logic === "AND" ? andTri(results) : orTri(results);
  return group.negate ? notTri(combined) : combined;
}

function evalNode(node: Node, ctx: EvalContext): Tri {
  return isGroup(node) ? evalGroup(node, ctx) : evalRule(node as Rule, ctx);
}

/** True, pokud query obsahuje alespoň jedno obsahové (body) pravidlo. */
export function queryTouchesBody(node: Node): boolean {
  if (isGroup(node)) return node.children.some(queryTouchesBody);
  return isContentField((node as Rule).field);
}
