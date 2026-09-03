import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
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
});

function mount(doc: string, cursor = 0, onOpen?: (target: string) => void): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        markdownTableExtension,
        markdownTableTheme,
        ...(onOpen ? wikilinkExtension(onOpen) : []),
      ],
    }),
    parent,
  });
}

describe("parseMarkdownTables", () => {
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

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith("Eintopf");
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
