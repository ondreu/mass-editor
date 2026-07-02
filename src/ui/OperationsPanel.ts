import { type App, setIcon } from "obsidian";
import {
  type EditOp,
  type FmValueType,
  OP_LABELS,
  isOpValid,
} from "../edit/operations";
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
    case "tag-add":
    case "tag-remove":
      return { kind, tag: "" };
    case "body-regex":
      return { kind, pattern: "", flags: "g", replacement: "" };
    case "body-append":
    case "body-prepend":
      return { kind, text: "" };
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
