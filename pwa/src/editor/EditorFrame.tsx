import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";

const storageKey = "lokyy.editor.width";
const changeEvent = "lokyy-editor-width-change";
const widths = { reading: "640px", wide: "960px", full: "100%" } as const;
type Width = keyof typeof widths;
// Keep failed preference writes available to editors opened later in this tab.
let unsavedWidth: Width | null = null;
function parseWidth(value: unknown): Width {
  return value === "reading" || value === "full" ? value : "wide";
}
function initialWidth(): Width {
  if (unsavedWidth !== null) return unsavedWidth;
  try { return parseWidth(localStorage.getItem(storageKey)); }
  catch { return "wide"; }
}

/** Presentation only: never recreate CodeMirror or modify the note on a width change. */
export function EditorFrame({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(initialWidth);
  const [persisted, setPersisted] = useState(() => unsavedWidth === null);
  const id = useId();
  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ width: Width; persisted: boolean }>).detail;
      setWidth(parseWidth(detail.width));
      setPersisted(detail.persisted);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      unsavedWidth = null;
      setWidth(parseWidth(event.newValue));
      setPersisted(true);
    };
    window.addEventListener(changeEvent, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(changeEvent, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const chooseWidth = (value: string) => {
    const next = parseWidth(value);
    let saved = true;
    try { localStorage.setItem(storageKey, next); }
    catch { saved = false; }
    unsavedWidth = saved ? null : next;
    // Also synchronize the other pane in split view; storage events only reach other tabs.
    window.dispatchEvent(new CustomEvent(changeEvent, { detail: { width: next, persisted: saved } }));
  };
  return (
    <div data-testid="editor-frame" style={{
      "--lokyy-editor-width": widths[width],
      height: "100%", minHeight: 0, minWidth: 0,
      display: "flex", flexDirection: "column",
    } as CSSProperties}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end",
        flexWrap: "wrap", gap: 8, padding: "4px 16px", flexShrink: 0 }}>
        {!persisted && <span role="status" style={{ fontSize: 12 }}>Nicht dauerhaft gespeichert</span>}
        <label htmlFor={id} style={{ fontSize: 12, color: "#A8AFBD" }}>Textbreite</label>
        <select id={id} value={width} onChange={event => chooseWidth(event.target.value)}
          style={{ font: "inherit", fontSize: 12, color: "#E6E8EC", background: "#1C222C",
            border: "1px solid #454F60", borderRadius: 6, minHeight: 36, padding: "4px 8px", maxWidth: "100%" }}>
          <option value="reading">Lesebreite</option>
          <option value="wide">Breit</option>
          <option value="full">Volle Breite</option>
        </select>
      </div>
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>{children}</div>
    </div>
  );
}
