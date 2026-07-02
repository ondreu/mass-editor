import { type App, setIcon } from "obsidian";
import {
  type FieldType,
  type Group,
  type Node,
  type Rule,
  isGroup,
} from "../query/types";
import {
  OPERATORS,
  type ValueInput,
  defaultOpFor,
  inputTypeFor,
} from "../query/operators";
import { ListSuggest, type SuggestSources } from "./suggest";
import { uid } from "./dom";

const FIELD_LABELS: Record<FieldType, string> = {
  tag: "Tag",
  frontmatter: "Frontmatter",
  body: "Body",
  name: "Name",
  path: "Path",
  location: "Location",
  created: "Created",
  modified: "Modified",
};

const FIELD_ORDER: FieldType[] = [
  "tag",
  "frontmatter",
  "body",
  "name",
  "path",
  "location",
  "created",
  "modified",
];

export function newRule(): Rule {
  return { id: uid("r"), field: "tag", op: defaultOpFor("tag"), value: "" };
}

export function newGroup(logic: "AND" | "OR" = "AND"): Group {
  return { id: uid("g"), logic, children: [] };
}

/**
 * Recursive query builder in plain DOM.
 * `onStructure` = a node was added/removed (re-renders the tree).
 * `onValue` = a value changed (only refreshes the live count).
 */
export class QueryBuilder {
  private container!: HTMLElement;

  constructor(
    private root: Group,
    private app: App,
    private sources: SuggestSources,
    private onStructure: () => void,
    private onValue: () => void
  ) {}

  mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  private rerender(): void {
    this.render();
    this.onStructure();
  }

  private render(): void {
    this.container.empty();
    this.renderGroup(this.container, this.root, null, -1);
  }

  private renderGroup(
    parent: HTMLElement,
    group: Group,
    parentGroup: Group | null,
    index: number
  ): void {
    const box = parent.createDiv({ cls: "me-group" });

    const header = box.createDiv({ cls: "me-group__header" });
    this.renderLogic(header, group);
    this.renderNot(header, () => group.negate, (v) => (group.negate = v));

    const adders = header.createDiv({ cls: "me-group__adders" });
    this.addButton(adders, "plus", "Rule", () => {
      group.children.push(newRule());
      this.rerender();
    });
    this.addButton(adders, "folder-plus", "Group", () => {
      group.children.push(newGroup(group.logic === "AND" ? "OR" : "AND"));
      this.rerender();
    });
    if (parentGroup) {
      this.iconButton(adders, "trash-2", "Remove group", () => {
        parentGroup.children.splice(index, 1);
        this.rerender();
      });
    }

    const body = box.createDiv({ cls: "me-group__body" });
    if (group.children.length === 0) {
      body.createDiv({ cls: "me-empty", text: "No rules yet." });
    }
    group.children.forEach((child: Node, i: number) => {
      if (isGroup(child)) this.renderGroup(body, child, group, i);
      else this.renderRule(body, child as Rule, group, i);
    });
  }

  private renderLogic(parent: HTMLElement, group: Group): void {
    const wrap = parent.createDiv({ cls: "me-logic" });
    (["AND", "OR"] as const).forEach((logic) => {
      const btn = wrap.createEl("button", { text: logic });
      btn.toggleClass("is-active", group.logic === logic);
      btn.onclick = () => {
        if (group.logic !== logic) {
          group.logic = logic;
          this.rerender();
        }
      };
    });
  }

  private renderNot(
    parent: HTMLElement,
    get: () => boolean | undefined,
    set: (v: boolean) => void
  ): void {
    const btn = parent.createEl("button", { cls: "me-not", text: "NOT" });
    btn.toggleClass("is-active", !!get());
    btn.setAttribute("aria-label", "Negate");
    btn.onclick = () => {
      set(!get());
      btn.toggleClass("is-active", !!get());
      this.onValue();
    };
  }

  private renderRule(
    parent: HTMLElement,
    rule: Rule,
    group: Group,
    index: number
  ): void {
    const row = parent.createDiv({ cls: "me-rule" });

    this.renderNot(
      row,
      () => rule.negate,
      (v) => (rule.negate = v)
    );

    const fieldSel = row.createEl("select", { cls: "dropdown me-field" });
    FIELD_ORDER.forEach((f) => {
      const opt = fieldSel.createEl("option", { text: FIELD_LABELS[f] });
      opt.value = f;
      if (rule.field === f) opt.selected = true;
    });
    fieldSel.onchange = () => {
      rule.field = fieldSel.value as FieldType;
      rule.op = defaultOpFor(rule.field);
      rule.value = "";
      rule.value2 = undefined;
      rule.key = rule.field === "frontmatter" ? rule.key ?? "" : undefined;
      this.rerender();
    };

    if (rule.field === "frontmatter") {
      const keyInput = row.createEl("input", {
        cls: "me-key",
        attr: { type: "text", placeholder: "key" },
      });
      keyInput.value = rule.key ?? "";
      keyInput.oninput = () => {
        rule.key = keyInput.value;
        this.onValue();
      };
      new ListSuggest(
        this.app,
        keyInput,
        () => this.sources.frontmatterKeys(),
        (v) => {
          rule.key = v;
          this.onValue();
        }
      );
    }

    const opSel = row.createEl("select", { cls: "dropdown" });
    OPERATORS[rule.field].forEach((o) => {
      const opt = opSel.createEl("option", { text: o.label });
      opt.value = o.op;
      if (rule.op === o.op) opt.selected = true;
    });
    opSel.onchange = () => {
      rule.op = opSel.value;
      rule.value = "";
      rule.value2 = undefined;
      this.rerender();
    };

    this.renderValueInput(row, rule, inputTypeFor(rule.field, rule.op));

    this.iconButton(row, "x", "Remove rule", () => {
      group.children.splice(index, 1);
      this.rerender();
    });
  }

  private renderValueInput(
    row: HTMLElement,
    rule: Rule,
    input: ValueInput
  ): void {
    switch (input) {
      case "none":
        return;
      case "number":
      case "text":
      case "glob":
      case "folder": {
        const el = row.createEl("input", {
          cls: "me-value",
          attr: {
            type: input === "number" ? "number" : "text",
            placeholder: placeholderFor(input),
          },
        });
        el.value = rule.value != null ? String(rule.value) : "";
        el.oninput = () => {
          rule.value = el.value;
          this.onValue();
        };
        if (rule.field === "tag") {
          new ListSuggest(
            this.app,
            el,
            () => this.sources.tags(),
            (v) => {
              rule.value = v;
              this.onValue();
            }
          );
        } else if (input === "folder") {
          new ListSuggest(
            this.app,
            el,
            () => this.sources.folders(),
            (v) => {
              rule.value = v;
              this.onValue();
            }
          );
          this.subfolderToggle(row, rule);
        }
        return;
      }
      case "date": {
        const el = row.createEl("input", {
          cls: "me-value",
          attr: { type: "date" },
        });
        el.value = rule.value != null ? String(rule.value) : "";
        el.oninput = () => {
          rule.value = el.value;
          this.onValue();
        };
        return;
      }
      case "daterange": {
        const a = row.createEl("input", {
          cls: "me-value",
          attr: { type: "date" },
        });
        a.value = rule.value != null ? String(rule.value) : "";
        a.oninput = () => {
          rule.value = a.value;
          this.onValue();
        };
        row.createSpan({ cls: "me-range-sep", text: "–" });
        const b = row.createEl("input", {
          cls: "me-value",
          attr: { type: "date" },
        });
        b.value = rule.value2 != null ? String(rule.value2) : "";
        b.oninput = () => {
          rule.value2 = b.value;
          this.onValue();
        };
        return;
      }
    }
  }

  private addButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void
  ): void {
    const btn = parent.createEl("button", { cls: "me-add" });
    const ic = btn.createSpan();
    setIcon(ic, icon);
    btn.createSpan({ text: label });
    btn.onclick = onClick;
  }

  /** Clearly-stated on/off toggle for "include subfolders". */
  private subfolderToggle(row: HTMLElement, rule: Rule): void {
    const on = () => rule.flag !== false;
    const btn = row.createEl("button", { cls: "me-toggle" });
    const sync = () => {
      btn.toggleClass("is-active", on());
      btn.empty();
      const ic = btn.createSpan({ cls: "me-toggle__icon" });
      setIcon(ic, on() ? "check" : "minus");
      btn.createSpan({ text: on() ? "incl. subfolders" : "this folder only" });
      btn.setAttribute("aria-label", "Toggle including subfolders");
    };
    sync();
    btn.onclick = () => {
      rule.flag = !on();
      sync();
      this.onValue();
    };
  }

  private iconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void
  ): void {
    const btn = parent.createEl("div", { cls: "clickable-icon" });
    setIcon(btn, icon);
    btn.setAttribute("aria-label", label);
    btn.onclick = onClick;
  }
}

function placeholderFor(input: ValueInput): string {
  switch (input) {
    case "glob":
      return "project/*";
    case "folder":
      return "Folder/Subfolder";
    case "number":
      return "number";
    default:
      return "value";
  }
}
