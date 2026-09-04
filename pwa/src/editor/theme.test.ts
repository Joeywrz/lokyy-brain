import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it } from "vitest";
import { lokyyHighlight, lokyyTheme } from "./theme.js";
import { wikilinkExtension } from "./wikilink.js";

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  document.body.replaceChildren();
});

it("keeps prose, lists, quotes, code and tags neutral while links are accented", () => {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: "Plain text\n\n- Ingredient\n\n1. Instruction\n\n> Quotation\n\n`code`\n\n#tag\n\n[[Recipe]]",
      extensions: [markdown(), lokyyTheme, lokyyHighlight, wikilinkExtension(() => {})],
    }),
  });
  const foreground = getComputedStyle(view.dom).color;
  for (const text of ["Ingredient", "Instruction", "Quotation", "code", "#tag"]) {
    const element = [...view.dom.querySelectorAll<HTMLElement>(".cm-line span")]
      .find((el) => el.children.length === 0 && el.textContent?.includes(text));
    expect(element, text).toBeDefined();
    expect(getComputedStyle(element!).color, text).toBe(foreground);
  }
  const link = view.dom.querySelector<HTMLElement>("[data-link]")!;
  expect(getComputedStyle(link).color).not.toBe(foreground);
});
