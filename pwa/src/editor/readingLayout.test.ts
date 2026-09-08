import { afterEach, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { lokyyTheme } from "./theme.js";
import { livePreview } from "./livePreview.js";

let view: EditorView | undefined;
afterEach(() => { view?.destroy(); document.body.replaceChildren(); });
it("centers headings and prose on one bounded measure within a wider canvas", () => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.setProperty("--lokyy-editor-width", "100%");
  view = new EditorView({ parent: host, doc: "# Heading\n\nParagraph\n\n- List item", extensions: [markdown(), lokyyTheme, livePreview] });
  const lines = [...host.querySelectorAll<HTMLElement>(".cm-line")];
  expect(lines.length).toBeGreaterThan(2);
  for (const line of lines) {
    const style = getComputedStyle(line);
    expect(style.maxWidth).toBe("800px");
    expect(style.marginLeft).toBe("auto");
    expect(style.marginRight).toBe("auto");
    expect(style.boxSizing).toBe("border-box");
  }
});
