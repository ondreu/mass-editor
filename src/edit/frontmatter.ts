/**
 * Frontmatter → body conversion helpers.
 *
 * A "move to body" operation reads a frontmatter value, renders it through a
 * template (a preset one or a custom rule) and inserts the result into the note
 * body (append or prepend), optionally dropping the key from the frontmatter.
 */

/** A ready-made template for rendering a moved frontmatter entry. */
export interface FmToBodyPreset {
  id: string;
  label: string;
  /** Template with `{{key}}` / `{{value}}` placeholders. */
  template: string;
}

/**
 * Built-in templates. `{{key}}` is the frontmatter key, `{{value}}` its value
 * (lists are joined with ", "). Custom rules are just any other template text.
 */
export const FM_TO_BODY_PRESETS: FmToBodyPreset[] = [
  { id: "heading", label: "Heading + value", template: "## {{key}}\n\n{{value}}" },
  { id: "bold", label: "Bold label — **key:** value", template: "**{{key}}:** {{value}}" },
  { id: "field", label: "Plain line — key: value", template: "{{key}}: {{value}}" },
  {
    id: "dataview",
    label: "Dataview inline field — key:: value",
    template: "{{key}}:: {{value}}",
  },
  { id: "bullet", label: "Bullet — - key: value", template: "- {{key}}: {{value}}" },
  { id: "quote", label: "Blockquote — > value", template: "> {{value}}" },
  { id: "value", label: "Value only", template: "{{value}}" },
];

/** Renders a frontmatter value into a single string suitable for the body. */
export function fmValueToString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value))
    return value.map((v) => fmValueToString(v)).filter((s) => s !== "").join(", ");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Fills `{{key}}` / `{{value}}` placeholders (whitespace-tolerant). */
export function renderFmTemplate(
  template: string,
  key: string,
  value: unknown
): string {
  const v = fmValueToString(value);
  return template
    .replace(/\{\{\s*key\s*\}\}/g, key)
    .replace(/\{\{\s*value\s*\}\}/g, v);
}

/** Finds the preset matching a template, or null when it's a custom rule. */
export function presetForTemplate(template: string): FmToBodyPreset | null {
  return FM_TO_BODY_PRESETS.find((p) => p.template === template) ?? null;
}
