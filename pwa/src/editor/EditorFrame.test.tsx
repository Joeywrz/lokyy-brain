import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorFrame } from "./EditorFrame.js";

const key = "lokyy.editor.width";
beforeEach(() => localStorage.clear());
afterEach(() => {
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: null })));
  cleanup();
});

it("defaults to wide and exposes a labelled native control", () => {
  render(<EditorFrame><div>Editor</div></EditorFrame>);
  expect(screen.getByRole("combobox", { name: "Textbreite" })).toHaveValue("wide");
  expect(screen.getByTestId("editor-frame").style.getPropertyValue("--lokyy-editor-width")).toBe("960px");
});
it("restores valid preferences and rejects corrupt storage", () => {
  localStorage.setItem(key, "full");
  const r = render(<EditorFrame>Editor</EditorFrame>);
  expect(screen.getByRole("combobox")).toHaveValue("full");
  r.unmount();
  localStorage.setItem(key, "999999px");
  render(<EditorFrame>Editor</EditorFrame>);
  expect(screen.getByRole("combobox")).toHaveValue("wide");
});
it("changes width without remounting or editing the document", () => {
  const r = render(<EditorFrame><textarea defaultValue="Unsaved text" /></EditorFrame>);
  const doc = screen.getByRole("textbox");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "reading" } });
  expect(screen.getByRole("textbox")).toBe(doc);
  expect(doc).toHaveValue("Unsaved text");
  expect(localStorage.getItem(key)).toBe("reading");
  expect(screen.getByTestId("editor-frame").style.getPropertyValue("--lokyy-editor-width")).toBe("640px");
  r.unmount();
  render(<EditorFrame>Editor</EditorFrame>);
  expect(screen.getByRole("combobox")).toHaveValue("reading");
});
it("synchronizes split editors", () => {
  render(<><EditorFrame>A</EditorFrame><EditorFrame>B</EditorFrame></>);
  fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "full" } });
  expect(screen.getAllByRole("combobox").map(e => (e as HTMLSelectElement).value)).toEqual(["full", "full"]);
});
it("handles other-tab updates and storage clearing", () => {
  render(<EditorFrame>Editor</EditorFrame>);
  act(() => window.dispatchEvent(new StorageEvent("storage", { key, newValue: "reading" })));
  expect(screen.getByRole("combobox")).toHaveValue("reading");
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: null })));
  expect(screen.getByRole("combobox")).toHaveValue("wide");
});
it("still works if preference storage is blocked and reports the limitation", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  render(<EditorFrame>Editor</EditorFrame>);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "full" } });
  expect(screen.getByRole("combobox")).toHaveValue("full");
  expect(screen.getByRole("status")).toHaveTextContent("Nicht dauerhaft gespeichert");
});

it("retains a failed preference write for a newly opened split pane", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  const r = render(<><EditorFrame>A</EditorFrame></>);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "full" } });
  r.rerender(<><EditorFrame>A</EditorFrame><EditorFrame>B</EditorFrame></>);
  expect(screen.getAllByRole("combobox").map(e => (e as HTMLSelectElement).value)).toEqual(["full", "full"]);
  expect(screen.getAllByRole("status")).toHaveLength(2);
});
