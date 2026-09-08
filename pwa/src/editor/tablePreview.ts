import { markdownLanguage } from "@codemirror/lang-markdown";
import { type EditorState, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

export type TableAlignment = "left" | "center" | "right" | null;

export interface MarkdownTable {
  from: number;
  to: number;
  headers: string[];
  alignments: TableAlignment[];
  rows: string[][];
}

function splitTableRow(source: string): string[] {
  let line = source.trim();
  if (line.startsWith("|")) line = line.slice(1);

  const cells: string[] = [];
  let cell = "";
  let codeTicks = 0;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "\\" && line[i + 1] === "|") {
      cell += "|";
      i++;
      continue;
    }
    if (char === "`") {
      let run = 1;
      while (line[i + run] === "`") run++;
      codeTicks = codeTicks === run ? 0 : codeTicks === 0 ? run : codeTicks;
      cell += "`".repeat(run);
      i += run - 1;
      continue;
    }
    if (char === "|" && codeTicks === 0) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());

  if (cells.length > 1 && cells.at(-1) === "") cells.pop();
  return cells;
}

function parseAlignment(cell: string): TableAlignment | undefined {
  const marker = cell.replace(/\s/g, "");
  if (!/^:?-{3,}:?$/.test(marker)) return undefined;
  if (marker.startsWith(":") && marker.endsWith(":")) return "center";
  if (marker.endsWith(":")) return "right";
  if (marker.startsWith(":")) return "left";
  return null;
}

function normalizeRow(cells: string[], width: number): string[] {
  return Array.from({ length: width }, (_, index) => cells[index] ?? "");
}

/** Use the editor's Markdown grammar for block boundaries, not a second scanner. */
export function parseMarkdownTables(source: string): MarkdownTable[] {
  // Frontmatter is note metadata, not Markdown. Preserve original document offsets.
  const frontmatter = source.match(/^---[^\S\n]*\n[\s\S]*?^(?:---|\.\.\.)[^\S\n]*(?:\n|$)/m);
  const offset = frontmatter?.index === 0 ? frontmatter[0].length : 0;
  if (!offset && source.split("\n", 1)[0].trim() === "---") return [];
  const body = source.slice(offset);
  const tables: MarkdownTable[] = [];
  for (const node of markdownLanguage.parser.parse(body).topNode.getChildren("Table")) {
    const lines = body.slice(node.from, node.to).split("\n");
    // Keep Lokyy's existing inline-code/escaped-pipe cell semantics.
    const headers = splitTableRow(lines[0]);
    const alignments = splitTableRow(lines[1]).map(parseAlignment);
    if (alignments.length !== headers.length || alignments.some((value) => value === undefined)) continue;
    tables.push({
      from: offset + node.from,
      to: offset + node.to,
      headers,
      alignments: alignments as TableAlignment[],
      rows: lines.slice(2).map((line) => normalizeRow(splitTableRow(line), headers.length)),
    });
  }
  return tables;
}

const INLINE_TOKEN = /(\[\[[^\]\n]+\]\]|\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\))/g;

function isSafeLinkTarget(target: string): boolean {
  if (/[\u0000-\u001f\u007f]/.test(target)) return false;
  const value = target.trim();
  if (!value) return false;
  if (!/^[a-z][a-z\d+.-]*:/i.test(value)) return !value.startsWith("//");
  return /^(https?:|mailto:|tel:)/i.test(value);
}

function appendInline(parent: HTMLElement, source: string): void {
  let offset = 0;
  for (const match of source.matchAll(INLINE_TOKEN)) {
    const index = match.index ?? 0;
    parent.append(document.createTextNode(source.slice(offset, index)));
    const token = match[0];

    if (token.startsWith("[[")) {
      const value = token.slice(2, -2);
      const separator = value.indexOf("|");
      const target = (separator >= 0 ? value.slice(0, separator) : value).trim();
      const label = (separator >= 0 ? value.slice(separator + 1) : value).trim();
      const link = document.createElement("button");
      link.type = "button";
      link.className = "cm-markdown-table-link";
      link.dataset.link = target;
      link.textContent = label;
      parent.append(link);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      parent.append(strong);
    } else if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      parent.append(code);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const label = linkMatch?.[1] ?? token;
      const target = linkMatch?.[2] ?? "";
      if (isSafeLinkTarget(target)) {
        const link = document.createElement("a");
        link.textContent = label;
        link.href = target;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        parent.append(link);
      } else {
        parent.append(document.createTextNode(label));
      }
    }
    offset = index + token.length;
  }
  parent.append(document.createTextNode(source.slice(offset)));
}

class MarkdownTableWidget extends WidgetType {
  constructor(readonly table: MarkdownTable) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof MarkdownTableWidget &&
      other.table.from === this.table.from &&
      other.table.to === this.table.to &&
      JSON.stringify(other.table) === JSON.stringify(this.table)
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-markdown-table-wrap";
    wrapper.title = "Klicken, um die Tabelle zu bearbeiten";
    // Let native controls keep focus and keyboard activation; CodeMirror's
    // keymap would otherwise turn Enter on a button into a document edit.
    wrapper.addEventListener("keydown", (event) => {
      if ((event.target as HTMLElement).closest("a, button")) event.stopPropagation();
    });
    wrapper.addEventListener("mousedown", (event) => {
      if ((event.target as HTMLElement).closest("a, button")) {
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      view.dispatch({
        selection: { anchor: this.table.from },
        scrollIntoView: true,
      });
      view.focus();
    });

    const table = document.createElement("table");
    table.className = "cm-markdown-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    this.table.headers.forEach((source, index) => {
      const th = document.createElement("th");
      if (this.table.alignments[index]) th.style.textAlign = this.table.alignments[index]!;
      appendInline(th, source);
      headRow.append(th);
    });
    thead.append(headRow);
    table.append(thead);

    const tbody = document.createElement("tbody");
    for (const row of this.table.rows) {
      const tr = document.createElement("tr");
      row.forEach((source, index) => {
        const td = document.createElement("td");
        if (this.table.alignments[index]) td.style.textAlign = this.table.alignments[index]!;
        appendInline(td, source);
        tr.append(td);
      });
      tbody.append(tr);
    }
    table.append(tbody);
    wrapper.append(table);
    return wrapper;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const selection = state.selection.main;
  const ranges = parseMarkdownTables(state.doc.toString())
    .filter((table) => selection.from > table.to || selection.to < table.from)
    .map((table) =>
      Decoration.replace({
        widget: new MarkdownTableWidget(table),
        block: true,
      }).range(table.from, table.to),
    );
  return Decoration.set(ranges, true);
}

export const markdownTableExtension = StateField.define<DecorationSet>({
  create: buildDecorations,
  update(decorations, transaction) {
    if (transaction.docChanged || transaction.selection) {
      return buildDecorations(transaction.state);
    }
    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const markdownTableTheme = EditorView.theme({
  // Let the editor shrink; only the table wrapper should scroll horizontally.
  ".cm-content": { minWidth: "0" },
  ".cm-markdown-table-wrap": {
    display: "block",
    maxWidth: "100%",
    margin: "10px 0",
    overflowX: "auto",
  },
  ".cm-markdown-table": {
    width: "100%",
    borderCollapse: "collapse",
    // Do not inherit CodeMirror's overflow-wrap:anywhere min-content sizing.
    overflowWrap: "normal",
    wordBreak: "normal",
    fontSize: "0.92em",
  },
  ".cm-markdown-table th": {
    padding: "8px 10px",
    borderBottom: "2px solid #3B4452",
    color: "#FFFFFF",
    fontWeight: "600",
    textAlign: "left",
  },
  ".cm-markdown-table td": {
    padding: "8px 10px",
    borderBottom: "1px solid #2A323D",
    color: "#FFFFFF",
    verticalAlign: "top",
  },
  ".cm-markdown-table tbody tr:hover": {
    background: "rgba(249,115,22,0.06)",
  },
  ".cm-markdown-table code": {
    padding: "1px 4px",
    border: "1px solid #2A323D",
    borderRadius: "4px",
    background: "#1A1F26",
    color: "#FFFFFF",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  },
  ".cm-markdown-table-link": {
    background: "none",
    border: "none",
    padding: "0",
    font: "inherit",
    textAlign: "inherit",
  },
  ".cm-markdown-table-link:focus-visible": {
    outline: "2px solid #F97316",
    outlineOffset: "2px",
  },
  ".cm-markdown-table a, .cm-markdown-table-link": {
    color: "#F97316",
    cursor: "pointer",
    textDecoration: "none",
    borderBottom: "1px solid #3B4452",
  },
});
