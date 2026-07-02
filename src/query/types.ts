// Data model for the query builder. The query root is always a Group.

export type LogicOp = "AND" | "OR";

export type FieldType =
  | "tag"
  | "frontmatter"
  | "body"
  | "name"
  | "path"
  | "location"
  | "created"
  | "modified";

/** Three-valued (Kleene) logic. `unknown` = undecided so far (body not read). */
export type Tri = true | false | "unknown";

export interface Rule {
  id: string;
  field: FieldType;
  /** Required for `frontmatter` — the key name. */
  key?: string;
  /** Operator, see operators.ts. */
  op: string;
  /** Value — type depends on the operator. */
  value?: unknown;
  /** Second value (e.g. `between`). */
  value2?: unknown;
  /** Extra toggle (e.g. location: include subfolders). */
  flag?: boolean;
  negate?: boolean;
}

export interface Group {
  id: string;
  logic: LogicOp;
  negate?: boolean;
  children: Array<Rule | Group>;
}

export type Query = Group;

export type Node = Rule | Group;

export function isGroup(node: Node): node is Group {
  return (node as Group).children !== undefined;
}

/** Fields evaluable purely from metadata (phase 1). */
export const METADATA_FIELDS: FieldType[] = [
  "tag",
  "frontmatter",
  "name",
  "path",
  "location",
  "created",
  "modified",
];

/** Fields that require reading the file body (phase 2). */
export const CONTENT_FIELDS: FieldType[] = ["body"];

export function isContentField(field: FieldType): boolean {
  return CONTENT_FIELDS.includes(field);
}
