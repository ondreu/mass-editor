// Datový model pro query builder. Kořen dotazu je vždy Group.

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

/** Tři-hodnotová (Kleene) logika. `unknown` = zatím nerozhodnuto (tělo nečteno). */
export type Tri = true | false | "unknown";

export interface Rule {
  id: string;
  field: FieldType;
  /** Povinné pro `frontmatter` — název klíče. */
  key?: string;
  /** Operátor, viz operators.ts. */
  op: string;
  /** Hodnota — typ dle operátoru. */
  value?: unknown;
  /** Druhá hodnota (např. `between`). */
  value2?: unknown;
  /** Doplňkový přepínač (např. location: včetně podsložek). */
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

/** Pole, která lze vyhodnotit čistě z metadat (fáze 1). */
export const METADATA_FIELDS: FieldType[] = [
  "tag",
  "frontmatter",
  "name",
  "path",
  "location",
  "created",
  "modified",
];

/** Pole vyžadující čtení těla souboru (fáze 2). */
export const CONTENT_FIELDS: FieldType[] = ["body"];

export function isContentField(field: FieldType): boolean {
  return CONTENT_FIELDS.includes(field);
}
