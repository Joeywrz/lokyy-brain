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

interface SourceLine {
  text: string;
  from: number;
  to: number;
}

function sourceLines(source: string): SourceLine[] {
  const lines = source.split("\n");
  let offset = 0;
  return lines.map((text) => {
    const line = { text, from: offset, to: offset + text.length };
    offset += text.length + 1;
    return line;
  });
}

function hasTablePipe(line: string): boolean {
  let codeTicks = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      i++;
      continue;
    }
    if (line[i] === "`") {
      let run = 1;
      while (line[i + run] === "`") run++;
      codeTicks = codeTicks === run ? 0 : codeTicks === 0 ? run : codeTicks;
      i += run - 1;
      continue;
    }
    if (line[i] === "|" && codeTicks === 0) return true;
  }
  return false;
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

/** Parse the GFM pipe-table subset used by normal Lokyy notes. */
export function parseMarkdownTables(source: string): MarkdownTable[] {
  const lines = sourceLines(source);
  const tables: MarkdownTable[] = [];
  let fence: { char: string; length: number } | null = null;
  let frontmatter = lines[0]?.text.trim() === "---";
  let htmlComment = false;

  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    if (frontmatter) {
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(line.text)) frontmatter = false;
      continue;
    }

    if (htmlComment || line.text.includes("<!--")) {
      htmlComment = !line.text.includes("-->");
      continue;
    }

    const fenceMatch = line.text.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (!fence && fenceMatch) {
      const marker = fenceMatch[1];
      fence = { char: marker[0], length: marker.length };
      continue;
    }
    if (fence) {
      const closingFence = line.text.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
      if (
        closingFence &&
        closingFence[1][0] === fence.char &&
        closingFence[1].length >= fence.length
      ) {
        fence = null;
      }
      continue;
    }
    if (/^( {4}|\t)/.test(line.text) || !hasTablePipe(line.text)) continue;

    const headers = splitTableRow(line.text);
    const delimiterLine = lines[i + 1];
    if (!hasTablePipe(delimiterLine.text)) continue;
    const delimiterCells = splitTableRow(delimiterLine.text);
    if (headers.length === 0 || delimiterCells.length !== headers.length) continue;

    const alignments = delimiterCells.map(parseAlignment);
    if (alignments.some((alignment) => alignment === undefined)) continue;

    const rows: string[][] = [];
    let lastLine = delimiterLine;
    let j = i + 2;
    while (j < lines.length && hasTablePipe(lines[j].text)) {
      rows.push(normalizeRow(splitTableRow(lines[j].text), headers.length));
      lastLine = lines[j];
      j++;
    }

    tables.push({
      from: line.from,
      to: lastLine.to,
      headers,
      alignments: alignments as TableAlignment[],
      rows,
    });
    i = j - 1;
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
      const link = document.createElement("span");
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
    wrapper.addEventListener("mousedown", (event) => {
      if ((event.target as HTMLElement).closest("a, .cm-markdown-table-link")) return;
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
  ".cm-markdown-table-wrap": {
    display: "block",
    maxWidth: "100%",
    margin: "10px 0",
    overflowX: "auto",
  },
  ".cm-markdown-table": {
    width: "100%",
    borderCollapse: "collapse",
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
    color: "#FFA94D",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  },
  ".cm-markdown-table a, .cm-markdown-table-link": {
    color: "#F97316",
    cursor: "pointer",
    textDecoration: "none",
    borderBottom: "1px solid #3B4452",
  },
});
