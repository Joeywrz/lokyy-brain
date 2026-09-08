import { CompletionContext } from "@codemirror/autocomplete";
import { EditorSelection, EditorState } from "@codemirror/state";
import { api } from "../api.js";
import { wikilinkSource } from "./wikilinkAutocomplete.js";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wikilinkExtension } from "./wikilink.js";
import {
  markdownTableExtension,
  markdownTableTheme,
  parseMarkdownTables,
} from "./tablePreview.js";

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function mount(doc: string, cursor = 0, onOpen?: (target: string) => void, onOpenSplit?: (target: string) => void): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        keymap.of(defaultKeymap),
        markdownTableExtension,
        markdownTableTheme,
        EditorView.lineWrapping,
        ...(onOpen ? wikilinkExtension(onOpen, onOpenSplit) : []),
      ],
    }),
    parent,
  });
}

describe("parseMarkdownTables", () => {
  it.each(["# Heading | text", "> quote | text", "- list | text", "```text | code"])(
    "ends the table before the Markdown block %s",
    (followingBlock) => {
      const source = "| A | B |\n| --- | --- |\n| one | two |";
      const [table] = parseMarkdownTables(`${source}\n${followingBlock}`);
      expect(table.rows).toEqual([["one", "two"]]);
      expect(table.to).toBe(source.length);
    },
  );

  it.each(["```", "~~~~"])("ignores comment openers inside %s fences", (fence) => {
    const prefix = `${fence}html\n<!--\n${fence}\n\n`;
    const source = "| A | B |\n| --- | --- |\n| one | two |";
    expect(parseMarkdownTables(prefix + source)).toEqual([
      { from: prefix.length, to: prefix.length + source.length,
        headers: ["A", "B"], alignments: [null, null], rows: [["one", "two"]] },
    ]);
  });

  it("preserves source offsets after frontmatter and between tables", () => {
    const prefix = "---\nexample: |\n  | A | B |\n  |---|---|\n---\n\n";
    const table = "| A | B |\n|---|---|\n| one | two |";
    const separator = "\n# Heading | text\n\n";
    const source = prefix + table + separator + table;
    const parsed = parseMarkdownTables(source);
    expect(parsed).toHaveLength(2);
    expect(parsed.map(({ from, to }) => source.slice(from, to))).toEqual([table, table]);
    expect(parsed.map(({ from }) => from)).toEqual([prefix.length, prefix.length + table.length + separator.length]);
  });

  it("parses a GFM table with column alignment", () => {
    const [table] = parseMarkdownTables(
      "Intro\n\n| Name | kcal | Protein |\n|:-----|-----:|:-------:|\n| Eintopf | 697 | 51 g |\n",
    );

    expect(table).toMatchObject({
      headers: ["Name", "kcal", "Protein"],
      alignments: ["left", "right", "center"],
      rows: [["Eintopf", "697", "51 g"]],
    });
  });

  it("keeps escaped and inline-code pipes inside their cells", () => {
    const [table] = parseMarkdownTables(
      "| Ausdruck | Erklärung |\n|---|---|\n| `a | b` | links \\| rechts |",
    );

    expect(table.rows).toEqual([["`a | b`", "links | rechts"]]);
  });

  it("ignores table-looking text inside fenced code", () => {
    expect(
      parseMarkdownTables("```markdown\n| A | B |\n|---|---|\n| 1 | 2 |\n```")
    ).toEqual([]);
  });

  it("ignores tables inside indented code, frontmatter, and HTML comments", () => {
    const source = [
      "---",
      "example: |",
      "  | A | B |",
      "  |---|---|",
      "---",
      "",
      "    | A | B |",
      "    |---|---|",
      "",
      "<!--",
      "| A | B |",
      "|---|---|",
      "-->",
    ].join("\n");

    expect(parseMarkdownTables(source)).toEqual([]);
  });

  it("does not close a fence when the marker has trailing content", () => {
    expect(
      parseMarkdownTables("```markdown\n```still code\n| A | B |\n|---|---|\n```")
    ).toEqual([]);
  });
});

describe("markdownTableExtension", () => {
  const table =
    "Text davor\n\n| **Rezept** | Protein |\n|---|---:|\n| [[Eintopf]] | 51 g |\n";

  it("renders an inactive table as semantic table markup", () => {
    view = mount(table, 0);

    const rendered = view.dom.querySelector("table.cm-markdown-table");
    expect(rendered).not.toBeNull();
    expect(rendered?.querySelectorAll("thead th")).toHaveLength(2);
    expect(rendered?.querySelectorAll("tbody td")).toHaveLength(2);
    expect(rendered?.textContent).toContain("Rezept");
    expect(rendered?.textContent).toContain("Eintopf");
    expect(rendered?.textContent).not.toContain("**");
    expect(rendered?.textContent).not.toContain("[[");
  });

  it("keeps the raw Markdown editable while the cursor is in the table", () => {
    const tableStart = table.indexOf("| **Rezept**");
    view = mount(table, tableStart + 2);

    expect(view.dom.querySelector("table.cm-markdown-table")).toBeNull();
    expect(view.state.doc.toString()).toContain("| **Rezept** | Protein |");
  });

  it("reveals the raw Markdown when the rendered table is clicked", () => {
    view = mount(table, 0);
    const wrapper = view.dom.querySelector<HTMLElement>(".cm-markdown-table-wrap");

    wrapper?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(view.dom.querySelector("table.cm-markdown-table")).toBeNull();
    expect(view.state.selection.main.from).toBe(table.indexOf("| **Rezept**"));
  });

  it("opens a wikilink cell through the production link handler", () => {
    const onOpen = vi.fn();
    view = mount(table, 0, onOpen);

    const link = view.dom.querySelector<HTMLElement>(".cm-markdown-table-link");
    link?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    link?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith("Eintopf");
  });

  it("makes table wikilinks native focusable buttons", () => {
    view = mount(table, 0, vi.fn());
    const link = view.dom.querySelector<HTMLButtonElement>(".cm-markdown-table-link");
    expect(link?.tagName).toBe("BUTTON");
    expect(link?.type).toBe("button");
    expect(link?.tabIndex).toBe(0);
    link?.focus();
    expect(document.activeElement).toBe(link);
  });

  it.each(["Enter", " "])("leaves %j to the native button, not the editor keymap", (key) => {
    view = mount(table, 0, vi.fn());
    const link = view.dom.querySelector<HTMLElement>(".cm-markdown-table-link")!;
    link.focus();
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(view.state.doc.toString()).toBe(table);
    expect(document.activeElement).toBe(link);
  });

  it.each([{}, { ctrlKey: true }, { metaKey: true }])(
    "routes native keyboard clicks canonically with modifiers %j",
    async (modifiers) => {
      vi.spyOn(api, "listNotes").mockResolvedValue([{
        id: "20_notes/rezepte/eintopf", path: "20_notes/rezepte/eintopf.md",
        title: "Eintopf", aliases: [], tags: [], links: [], updatedAt: "2026-09-04T00:00:00.000Z",
      }]);
      const state = EditorState.create({ doc: "[[Ein" });
      await wikilinkSource(new CompletionContext(state, state.doc.length, true));
      const onOpen = vi.fn();
      const onOpenSplit = vi.fn();
      view = mount(table, 0, onOpen, onOpenSplit);
      const link = view.dom.querySelector<HTMLElement>(".cm-markdown-table-link")!;
      // Browsers activate native buttons from Enter/Space with a detail=0 click.
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0, ...modifiers }));
      const split = "ctrlKey" in modifiers || "metaKey" in modifiers;
      expect(split ? onOpenSplit : onOpen).toHaveBeenCalledOnce();
      expect(split ? onOpenSplit : onOpen).toHaveBeenCalledWith("20_notes/rezepte/eintopf");
      expect(split ? onOpen : onOpenSplit).not.toHaveBeenCalled();
      expect(view.state.doc.toString()).toBe(table);
      expect(view.dom.querySelector("table")).not.toBeNull();
    },
  );

  it.each([{ ctrlKey: true }, { metaKey: true }])("splits one mouse activation only: %j", (modifiers) => {
    const onOpen = vi.fn();
    const onOpenSplit = vi.fn();
    view = mount(table, 0, onOpen, onOpenSplit);
    const link = view.dom.querySelector<HTMLElement>(".cm-markdown-table-link")!;
    const nested = document.createElement("span");
    nested.textContent = link.textContent;
    link.replaceChildren(nested);
    for (const type of ["mousedown", "mouseup", "click"]) {
      nested.dispatchEvent(new MouseEvent(type, { bubbles: true, detail: 1, ...modifiers }));
    }
    expect(onOpenSplit).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe(table);
  });

  it("prevents inherited anywhere column compression", () => {
    view = mount("Intro\n\n| Description | Status | Protein |\n|---|---|---|\n| " + "x".repeat(350) + " | Ready | 51 g |", 0);
    expect(getComputedStyle(view.dom.querySelector("table")!).overflowWrap).toBe("normal");
    expect(getComputedStyle(view.dom.querySelector("table")!).wordBreak).toBe("normal");
    expect(getComputedStyle(view.contentDOM).minWidth).toBe("0px");
  });

  it("uses neutral white inline code", () => {
    view = mount("Intro\n\n| Code |\n|---|\n| `sample` |", 0);
    expect(getComputedStyle(view.dom.querySelector("table code")!).color).toBe("rgb(255, 255, 255)");
  });

  it("preserves the whole document when preview is entered and left", () => {
    const source = table + "# Heading | text\n";
    view = mount(source, 0);
    view.dom.querySelector<HTMLElement>("td")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(view.dom.querySelector("table")).toBeNull();
    view.dispatch({ selection: { anchor: 0 } });
    expect(view.dom.querySelector("table")).not.toBeNull();
    expect(view.state.doc.toString()).toBe(source);
    expect(view.dom.textContent).toContain("# Heading | text");
  });

  it("does not create executable links from unsafe URL schemes", () => {
    view = mount(
      "Text davor\n\n| Link |\n|---|\n| [nicht klicken](javascript:alert(1)) |",
      0,
    );

    expect(view.dom.querySelector("a")).toBeNull();
    expect(view.dom.textContent).toContain("nicht klicken");
  });

  it("rejects URL schemes disguised with ASCII control characters", () => {
    view = mount(
      "Text davor\n\n| Link |\n|---|\n| [nicht klicken](java\tscript:alert(1)) |",
      0,
    );

    expect(view.dom.querySelector("a")).toBeNull();
    expect(view.dom.textContent).toContain("nicht klicken");
  });
});
