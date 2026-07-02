import { setIcon } from "obsidian";
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
import { uid } from "./dom";

const FIELD_LABELS: Record<FieldType, string> = {
  tag: "Tag",
  frontmatter: "Frontmatter",
  body: "Tělo",
  name: "Název",
  path: "Cesta",
  location: "Umístění",
  created: "Vytvořeno",
  modified: "Upraveno",
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
 * Rekurzivní query builder v čistém DOM.
 * `onStructure` = přidání/odebrání uzlu (překreslí strom).
 * `onValue` = změna hodnoty (jen přepočet počítadla).
 */
export class QueryBuilder {
  private container!: HTMLElement;

  constructor(
    private root: Group,
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
    this.renderGroup(this.container, this.root, null, -1, 0);
  }

  private renderGroup(
    parent: HTMLElement,
    group: Group,
    parentGroup: Group | null,
    index: number,
    depth: number
  ): void {
    const box = parent.createDiv({ cls: "me-group" });
    if (group.negate) box.addClass("me-group--negated");
    box.style.setProperty("--me-depth", String(depth));

    // hlavička skupiny
    const header = box.createDiv({ cls: "me-group__header" });

    const logicWrap = header.createDiv({ cls: "me-logic" });
    this.makeLogicToggle(logicWrap, group);

    const notBtn = header.createEl("button", {
      cls: "me-badge me-badge--not" + (group.negate ? " is-active" : ""),
      text: "NOT",
    });
    notBtn.setAttribute("aria-label", "Negovat skupinu");
    notBtn.onclick = () => {
      group.negate = !group.negate;
      this.rerender();
    };

    const spacer = header.createDiv({ cls: "me-spacer" });
    void spacer;

    this.iconButton(header, "plus", "+ Pravidlo", () => {
      group.children.push(newRule());
      this.rerender();
    });
    this.iconButton(header, "folder-plus", "+ Skupina", () => {
      group.children.push(newGroup(group.logic === "AND" ? "OR" : "AND"));
      this.rerender();
    });

    if (parentGroup) {
      const del = header.createEl("button", {
        cls: "me-icon-btn me-icon-btn--danger",
      });
      setIcon(del, "trash-2");
      del.setAttribute("aria-label", "Smazat skupinu");
      del.onclick = () => {
        parentGroup.children.splice(index, 1);
        this.rerender();
      };
    }

    // děti
    const body = box.createDiv({ cls: "me-group__body" });
    if (group.children.length === 0) {
      body.createDiv({
        cls: "me-empty",
        text: "Prázdná skupina — přidejte pravidlo nebo skupinu.",
      });
    }
    group.children.forEach((child: Node, i: number) => {
      if (isGroup(child)) {
        this.renderGroup(body, child, group, i, depth + 1);
      } else {
        this.renderRule(body, child as Rule, group, i);
      }
    });
  }

  private makeLogicToggle(wrap: HTMLElement, group: Group): void {
    (["AND", "OR"] as const).forEach((logic) => {
      const btn = wrap.createEl("button", {
        cls:
          "me-logic__btn" + (group.logic === logic ? " is-active" : ""),
        text: logic,
      });
      btn.onclick = () => {
        if (group.logic !== logic) {
          group.logic = logic;
          this.rerender();
        }
      };
    });
  }

  private renderRule(
    parent: HTMLElement,
    rule: Rule,
    group: Group,
    index: number
  ): void {
    const row = parent.createDiv({ cls: "me-rule" });

    const notBtn = row.createEl("button", {
      cls: "me-badge me-badge--not" + (rule.negate ? " is-active" : ""),
      text: "NOT",
    });
    notBtn.setAttribute("aria-label", "Negovat pravidlo");
    notBtn.onclick = () => {
      rule.negate = !rule.negate;
      notBtn.toggleClass("is-active", !!rule.negate);
      this.onValue();
    };

    // pole
    const fieldSel = row.createEl("select", { cls: "me-select" });
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

    // klíč (jen frontmatter)
    if (rule.field === "frontmatter") {
      const keyInput = row.createEl("input", {
        cls: "me-input me-input--key",
        attr: { type: "text", placeholder: "klíč" },
      });
      keyInput.value = rule.key ?? "";
      keyInput.oninput = () => {
        rule.key = keyInput.value;
        this.onValue();
      };
    }

    // operátor
    const opSel = row.createEl("select", { cls: "me-select" });
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

    // hodnota
    const input = inputTypeFor(rule.field, rule.op);
    this.renderValueInput(row, rule, input);

    // smazat
    const del = row.createEl("button", {
      cls: "me-icon-btn me-icon-btn--danger",
    });
    setIcon(del, "x");
    del.setAttribute("aria-label", "Smazat pravidlo");
    del.onclick = () => {
      group.children.splice(index, 1);
      this.rerender();
    };
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
          cls: "me-input",
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
        if (input === "folder") {
          const sub = row.createDiv({ cls: "me-check" });
          const cb = sub.createEl("input", { attr: { type: "checkbox" } });
          cb.checked = rule.flag !== false;
          cb.onchange = () => {
            rule.flag = cb.checked;
            this.onValue();
          };
          sub.createEl("label", { text: "vč. podsložek" });
        }
        return;
      }
      case "date": {
        const el = row.createEl("input", {
          cls: "me-input",
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
          cls: "me-input",
          attr: { type: "date" },
        });
        a.value = rule.value != null ? String(rule.value) : "";
        a.oninput = () => {
          rule.value = a.value;
          this.onValue();
        };
        row.createSpan({ cls: "me-range-sep", text: "–" });
        const b = row.createEl("input", {
          cls: "me-input",
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

  private iconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void
  ): void {
    const btn = parent.createEl("button", { cls: "me-text-btn", text: label });
    const ic = btn.createSpan({ cls: "me-text-btn__icon" });
    setIcon(ic, icon);
    ic.parentElement?.prepend(ic);
    btn.onclick = onClick;
  }
}

function placeholderFor(input: ValueInput): string {
  switch (input) {
    case "glob":
      return "project/*";
    case "folder":
      return "Složka/Podsložka";
    case "number":
      return "číslo";
    default:
      return "hodnota";
  }
}
