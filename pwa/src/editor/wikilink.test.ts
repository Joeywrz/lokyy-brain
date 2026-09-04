import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api.js";
import { wikilinkExtension } from "./wikilink.js";
import { wikilinkSource } from "./wikilinkAutocomplete.js";

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("wikilink navigation", () => {
  it("opens a title wikilink by its canonical note id", async () => {
    vi.spyOn(api, "listNotes").mockResolvedValue([
      {
        id: "20_notes/rezepte/kraftiges-chicken-cacciatore",
        path: "20_notes/rezepte/kraftiges-chicken-cacciatore.md",
        title: "Kräftiges Chicken Cacciatore",
        tags: ["rezept"],
        links: [],
        aliases: [],
        updatedAt: "2026-09-04T00:00:00.000Z",
      },
    ]);

    const completionState = EditorState.create({ doc: "[[Kräftig" });
    await wikilinkSource(
      new CompletionContext(completionState, completionState.doc.length, true),
    );

    const onOpen = vi.fn();
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    view = new EditorView({
      state: EditorState.create({
        doc: "[[Kräftiges Chicken Cacciatore]]",
        extensions: wikilinkExtension(onOpen),
      }),
      parent,
    });

    const link = view.dom.querySelector<HTMLElement>(".cm-wikilink");
    link?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith(
      "20_notes/rezepte/kraftiges-chicken-cacciatore",
    );
  });
});
