import { setIcon } from "obsidian";
import {
  type EditOp,
  type FmValueType,
  OP_LABELS,
  isOpValid,
} from "../edit/operations";
import { uid } from "./dom";

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

/** Panel pro skládání editačních operací. */
export class OperationsPanel {
  private container!: HTMLElement;
  private listEl!: HTMLElement;

  constructor(private ops: EditOp[], private onChange: () => void) {}

  mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  private render(): void {
    this.container.empty();

    const adder = this.container.createDiv({ cls: "me-op-adder" });
    const sel = adder.createEl("select", { cls: "me-select" });
    OP_MENU.forEach((o) => {
      const opt = sel.createEl("option", { text: o.label });
      opt.value = o.kind;
    });
    const addBtn = adder.createEl("button", {
      cls: "me-text-btn",
      text: "Přidat operaci",
    });
    const ic = addBtn.createSpan();
    setIcon(ic, "plus");
    addBtn.prepend(ic);
    addBtn.onclick = () => {
      this.ops.push(newOp(sel.value as OpKind));
      this.render();
      this.onChange();
    };

    this.listEl = this.container.createDiv({ cls: "me-op-list" });
    if (this.ops.length === 0) {
      this.listEl.createDiv({
        cls: "me-empty",
        text: "Zatím žádná operace. Přidejte alespoň jednu.",
      });
    }
    this.ops.forEach((op, i) => this.renderOp(op, i));
  }

  private renderOp(op: EditOp, index: number): void {
    const card = this.listEl.createDiv({ cls: "me-op" });
    if (!isOpValid(op)) card.addClass("me-op--invalid");

    const head = card.createDiv({ cls: "me-op__head" });
    head.createSpan({ cls: "me-op__title", text: OP_LABELS[op.kind] });
    const del = head.createEl("button", {
      cls: "me-icon-btn me-icon-btn--danger",
    });
    setIcon(del, "x");
    del.setAttribute("aria-label", "Odebrat operaci");
    del.onclick = () => {
      this.ops.splice(index, 1);
      this.render();
      this.onChange();
    };

    const body = card.createDiv({ cls: "me-op__body" });
    this.renderFields(body, op);
  }

  private text(
    parent: HTMLElement,
    placeholder: string,
    value: string,
    set: (v: string) => void,
    cls = ""
  ): void {
    const el = parent.createEl("input", {
      cls: "me-input " + cls,
      attr: { type: "text", placeholder },
    });
    el.value = value;
    el.oninput = () => {
      set(el.value);
      this.refreshValidity();
    };
  }

  private renderFields(body: HTMLElement, op: EditOp): void {
    switch (op.kind) {
      case "fm-set":
      case "fm-add": {
        this.text(body, "klíč", op.key, (v) => (op.key = v), "me-input--key");
        this.text(body, "hodnota", op.value, (v) => (op.value = v));
        const sel = body.createEl("select", { cls: "me-select" });
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
        this.text(body, "klíč", op.key, (v) => (op.key = v), "me-input--key");
        break;
      case "fm-list-append":
        this.text(body, "klíč", op.key, (v) => (op.key = v), "me-input--key");
        this.text(body, "hodnota", op.value, (v) => (op.value = v));
        break;
      case "tag-add":
      case "tag-remove":
        this.text(body, "tag (bez #)", op.tag, (v) => (op.tag = v));
        break;
      case "body-regex": {
        this.text(
          body,
          "vzor (regex)",
          op.pattern,
          (v) => (op.pattern = v),
          "me-input--grow"
        );
        this.text(body, "flags", op.flags, (v) => (op.flags = v), "me-input--flags");
        this.text(
          body,
          "náhrada ($1, $2…)",
          op.replacement,
          (v) => (op.replacement = v),
          "me-input--grow"
        );
        const err = body.createDiv({ cls: "me-op__err" });
        const validate = () => {
          try {
            new RegExp(op.pattern, op.flags);
            err.setText("");
            err.removeClass("is-visible");
          } catch (e) {
            err.setText(e instanceof Error ? e.message : "Neplatný regex");
            err.addClass("is-visible");
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
          cls: "me-textarea",
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

export { uid };
