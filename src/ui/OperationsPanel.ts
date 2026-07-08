import { type App, setIcon } from "obsidian";
import {
  type EditOp,
  type FmToBodyPosition,
  type FmValueType,
  OP_LABELS,
  isOpValid,
} from "../edit/operations";
import {
  FM_TO_BODY_PRESETS,
  presetForTemplate,
} from "../edit/frontmatter";
import {
  BLANK_LINE_PRESETS,
  DEFAULT_BLANK_LINE_RULES,
  presetForRules,
} from "../edit/blanklines";
import { ListSuggest, type SuggestSources } from "./suggest";

type OpKind = EditOp["kind"];

const OP_MENU: { kind: OpKind; label: string }[] = (
  Object.keys(OP_LABELS) as OpKind[]
).map((k) => ({ kind: k, label: OP_LABELS[k] }));

function newOp(kind: OpKind): EditOp {
  switch (kind) {
    case "fm-set":
    case "fm-add":
      return { kind, key: "", value: "", valueType: "string" };
    case "fm-delete":
      return { kind, key: "" };
    case "fm-list-append":
      return { kind, key: "", value: "" };
    case "fm-to-body":
      return {
        kind,
        key: "",
        position: "append",
        template: FM_TO_BODY_PRESETS[0].template,
        removeKey: true,
      };
    case "tag-add":
    case "tag-remove":
      return { kind, tag: "" };
    case "body-regex":
      return { kind, pattern: "", flags: "g", replacement: "" };
    case "body-append":
    case "body-prepend":
      return { kind, text: "" };
    case "body-blank-lines":
      return { kind, rules: { ...DEFAULT_BLANK_LINE_RULES } };
  }
}

/** Panel for composing edit operations. */
export class OperationsPanel {
  private container!: HTMLElement;
  private listEl!: HTMLElement;

  constructor(
    private ops: EditOp[],
    private app: App,
    private sources: SuggestSources,
    private onChange: () => void
  ) {}

  mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  private render(): void {
    this.container.empty();

    const add = this.container.createDiv({ cls: "me-op-add" });
    const sel = add.createEl("select", { cls: "dropdown" });
    OP_MENU.forEach((o) => {
      const opt = sel.createEl("option", { text: o.label });
      opt.value = o.kind;
    });
    const addBtn = add.createEl("button", { cls: "me-add" });
    const ic = addBtn.createSpan();
    setIcon(ic, "plus");
    addBtn.createSpan({ text: "Add operation" });
    addBtn.onclick = () => {
      this.ops.push(newOp(sel.value as OpKind));
      this.render();
      this.onChange();
    };

    this.listEl = this.container.createDiv({ cls: "me-op-list" });
    if (this.ops.length === 0) {
      this.listEl.createDiv({ cls: "me-empty", text: "No operations yet." });
    }
    this.ops.forEach((op, i) => this.renderOp(op, i));
  }

  private renderOp(op: EditOp, index: number): void {
    const card = this.listEl.createDiv({ cls: "me-op" });
    if (!isOpValid(op)) card.addClass("me-op--invalid");

    const head = card.createDiv({ cls: "me-op__head" });
    head.createSpan({ cls: "me-op__title", text: OP_LABELS[op.kind] });
    const del = head.createEl("div", { cls: "clickable-icon" });
    setIcon(del, "x");
    del.setAttribute("aria-label", "Remove operation");
    del.onclick = () => {
      this.ops.splice(index, 1);
      this.render();
      this.onChange();
    };

    this.renderFields(card.createDiv({ cls: "me-op-fields" }), op);
  }

  private text(
    parent: HTMLElement,
    placeholder: string,
    value: string,
    set: (v: string) => void,
    cls = "me-value",
    suggest?: () => string[]
  ): HTMLInputElement {
    const el = parent.createEl("input", {
      cls,
      attr: { type: "text", placeholder },
    });
    el.value = value;
    el.oninput = () => {
      set(el.value);
      this.refreshValidity();
    };
    if (suggest) {
      new ListSuggest(this.app, el, suggest, (v) => {
        set(v);
        this.refreshValidity();
      });
    }
    return el;
  }

  private select(
    parent: HTMLElement,
    options: { value: string; label: string }[],
    value: string,
    set: (v: string) => void
  ): HTMLSelectElement {
    const sel = parent.createEl("select", { cls: "dropdown" });
    options.forEach((o) => {
      const opt = sel.createEl("option", { text: o.label });
      opt.value = o.value;
      if (o.value === value) opt.selected = true;
    });
    sel.onchange = () => {
      set(sel.value);
      this.refreshValidity();
    };
    return sel;
  }

  private checkbox(
    parent: HTMLElement,
    label: string,
    value: boolean,
    set: (v: boolean) => void
  ): void {
    const wrap = parent.createEl("label", { cls: "me-check" });
    const cb = wrap.createEl("input", { attr: { type: "checkbox" } });
    cb.checked = value;
    cb.onchange = () => {
      set(cb.checked);
      this.refreshValidity();
    };
    wrap.createSpan({ text: label });
  }

  private renderFields(body: HTMLElement, op: EditOp): void {
    switch (op.kind) {
      case "fm-set":
      case "fm-add": {
        this.text(body, "key", op.key, (v) => (op.key = v), "me-key", () =>
          this.sources.frontmatterKeys()
        );
        this.text(body, "value", op.value, (v) => (op.value = v));
        const sel = body.createEl("select", { cls: "dropdown" });
        (["string", "number", "boolean", "list"] as FmValueType[]).forEach(
          (t) => {
            const o = sel.createEl("option", { text: t });
            o.value = t;
            if (op.valueType === t) o.selected = true;
          }
        );
        sel.onchange = () => {
          op.valueType = sel.value as FmValueType;
          this.refreshValidity();
        };
        break;
      }
      case "fm-delete":
        this.text(body, "key", op.key, (v) => (op.key = v), "me-key", () =>
          this.sources.frontmatterKeys()
        );
        break;
      case "fm-list-append":
        this.text(body, "key", op.key, (v) => (op.key = v), "me-key", () =>
          this.sources.frontmatterKeys()
        );
        this.text(body, "value", op.value, (v) => (op.value = v));
        break;
      case "fm-to-body": {
        const row = body.createDiv({ cls: "me-op-row" });
        this.text(row, "key", op.key, (v) => (op.key = v), "me-key", () =>
          this.sources.frontmatterKeys()
        );
        this.select(
          row,
          [
            { value: "append", label: "Append to body" },
            { value: "prepend", label: "Prepend to body" },
          ],
          op.position,
          (v) => (op.position = v as FmToBodyPosition)
        );
        // Format preset picker; "custom" keeps whatever is in the template box.
        const presetSel = this.select(
          body,
          [
            ...FM_TO_BODY_PRESETS.map((p) => ({ value: p.id, label: p.label })),
            { value: "custom", label: "Custom rule…" },
          ],
          presetForTemplate(op.template)?.id ?? "custom",
          () => {}
        );
        const ta = body.createEl("textarea", {
          cls: "me-fm2body__tpl",
          attr: { placeholder: "{{key}} / {{value}}", rows: "2" },
        });
        ta.value = op.template;
        presetSel.onchange = () => {
          const p = FM_TO_BODY_PRESETS.find((x) => x.id === presetSel.value);
          if (p) {
            op.template = p.template;
            ta.value = p.template;
          }
          this.refreshValidity();
        };
        ta.oninput = () => {
          op.template = ta.value;
          presetSel.value = presetForTemplate(op.template)?.id ?? "custom";
          this.refreshValidity();
        };
        body.createDiv({
          cls: "me-op__hint",
          text: "Placeholders: {{key}}, {{value}} (lists join with ', ').",
        });
        this.checkbox(
          body,
          "Remove the key from frontmatter",
          op.removeKey,
          (v) => (op.removeKey = v)
        );
        break;
      }
      case "tag-add":
      case "tag-remove":
        this.text(
          body,
          "tag (without #)",
          op.tag,
          (v) => (op.tag = v),
          "me-value",
          () => this.sources.tags()
        );
        break;
      case "body-regex": {
        this.text(body, "pattern", op.pattern, (v) => (op.pattern = v));
        this.text(body, "flags", op.flags, (v) => (op.flags = v), "me-flags");
        this.text(
          body,
          "replacement ($1, $2…)",
          op.replacement,
          (v) => (op.replacement = v)
        );
        const err = body.createDiv({ cls: "me-op__error" });
        const validate = () => {
          try {
            new RegExp(op.pattern, op.flags);
            err.setText("");
          } catch (e) {
            err.setText(e instanceof Error ? e.message : "Invalid regex");
          }
        };
        validate();
        body.querySelectorAll("input").forEach((inp) =>
          inp.addEventListener("input", validate)
        );
        break;
      }
      case "body-append":
      case "body-prepend": {
        const ta = body.createEl("textarea", {
          attr: { placeholder: "text…", rows: "3" },
        });
        ta.value = op.text;
        ta.oninput = () => {
          op.text = ta.value;
          this.refreshValidity();
        };
        break;
      }
      case "body-blank-lines": {
        const rules = op.rules;
        // Preset picker fills the rule set; toggling any rule → "custom".
        const presetSel = this.select(
          body,
          [
            ...BLANK_LINE_PRESETS.map((p) => ({ value: p.id, label: p.label })),
            { value: "custom", label: "Custom rules…" },
          ],
          presetForRules(rules)?.id ?? "custom",
          () => {}
        );

        const maxRow = body.createDiv({ cls: "me-op-row me-check" });
        maxRow.createSpan({ text: "Max consecutive blank lines" });
        const num = maxRow.createEl("input", {
          cls: "me-flags",
          attr: { type: "number", min: "0", step: "1" },
        });
        num.value = String(rules.maxConsecutive);

        const toggles = body.createDiv({ cls: "me-op-checks" });
        const syncPreset = () => {
          presetSel.value = presetForRules(rules)?.id ?? "custom";
        };

        num.oninput = () => {
          const n = parseInt(num.value, 10);
          rules.maxConsecutive = Number.isNaN(n) || n < 0 ? 0 : n;
          syncPreset();
          this.refreshValidity();
        };
        type BoolRuleKey = Exclude<keyof typeof rules, "maxConsecutive">;
        const check = (label: string, key: BoolRuleKey) =>
          this.checkbox(toggles, label, rules[key], (v) => {
            rules[key] = v;
            syncPreset();
          });
        check("After a heading", "collapseAfterHeading");
        check("Before a heading", "collapseBeforeHeading");
        check("Between list items", "collapseListItems");
        check("Between tasks", "collapseTasks");
        check("Trim start/end of note", "trimEnds");

        presetSel.onchange = () => {
          const p = BLANK_LINE_PRESETS.find((x) => x.id === presetSel.value);
          if (p) {
            op.rules = { ...p.rules };
            this.render();
          }
          this.refreshValidity();
        };
        break;
      }
    }
  }

  private refreshValidity(): void {
    const cards = this.listEl.querySelectorAll(".me-op");
    this.ops.forEach((op, i) => {
      const card = cards[i];
      if (card) card.toggleClass("me-op--invalid", !isOpValid(op));
    });
    this.onChange();
  }
}
