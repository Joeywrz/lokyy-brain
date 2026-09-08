import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Editor } from "./Editor.js";
import { SplitView } from "../SplitView.js";
import { api } from "../api.js";

// Only the network boundary is replaced; Editor and all CM extensions are real.
vi.mock("../api.js", () => ({ api: {
  listNotes: vi.fn(),
  getNote: vi.fn(),
  putNote: vi.fn(),
} }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.listNotes).mockResolvedValue([]);
  const note = { id: "secondary", path: "secondary.md", title: "Secondary", body: "Secondary draft",
    tags: [], links: [], aliases: [], updatedAt: "2026-09-08T00:00:00Z" };
  vi.mocked(api.getNote).mockResolvedValue(note);
  vi.mocked(api.putNote).mockResolvedValue({ ...note, synced: true });
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function editors(container: HTMLElement): EditorView[] {
  return [...container.querySelectorAll<HTMLElement>(".cm-editor")].map(element => {
    const view = EditorView.findFromDOM(element);
    if (!view) throw new Error("Missing CodeMirror view");
    return view;
  });
}

it("changes a real Editor's width without changing its document, selection or undo history", () => {
  const onChange = vi.fn();
  const { container } = render(<Editor noteId="primary" initialBody="Draft" onChange={onChange} onOpenLink={vi.fn()} />);
  const [view] = editors(container);
  act(() => view.dispatch({ changes: { from: 5, insert: " edited" }, selection: { anchor: 2, head: 8 } }));
  const state = view.state;
  onChange.mockClear();

  for (const value of ["reading", "full", "wide"]) {
    fireEvent.change(screen.getByRole("combobox", { name: "Ansichtsbreite" }), { target: { value } });
    expect(editors(container)[0]).toBe(view);
    expect(view.state).toBe(state);
    expect(view.state.doc.toString()).toBe("Draft edited");
    expect(view.state.selection.main.anchor).toBe(2);
    expect(view.state.selection.main.head).toBe(8);
  }
  expect(onChange).not.toHaveBeenCalled();
  act(() => { expect(undo(view)).toBe(true); });
  expect(view.state.doc.toString()).toBe("Draft");
});

it("synchronizes real split editors without restarting a pending secondary save", async () => {
  const onPrimaryChange = vi.fn();
  const { container } = render(<SplitView primaryNoteId="primary" primaryBody="Primary draft"
    onPrimaryChange={onPrimaryChange} onOpenLink={vi.fn()} secondaryNoteId="secondary"
    onClosePane={vi.fn()} onSecondaryOpen={vi.fn()} />);
  await act(async () => { await Promise.resolve(); });
  const views = editors(container);
  expect(views).toHaveLength(2);
  act(() => {
    for (const view of views) view.dispatch({ changes: { from: view.state.doc.length, insert: " edited" }, selection: { anchor: 2, head: 7 } });
  });
  const states = views.map(view => view.state);
  onPrimaryChange.mockClear();
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  fireEvent.change(screen.getAllByRole("combobox", { name: "Ansichtsbreite" })[1], { target: { value: "reading" } });
  expect(screen.getAllByRole("combobox").map(element => (element as HTMLSelectElement).value)).toEqual(["reading", "reading"]);
  expect(editors(container)).toHaveLength(2);
  editors(container).forEach((view, index) => {
    expect(view).toBe(views[index]);
    expect(view.state).toBe(states[index]);
    expect(view.state.selection.main.anchor).toBe(2);
    expect(view.state.selection.main.head).toBe(7);
  });
  expect(onPrimaryChange).not.toHaveBeenCalled();
  expect(api.putNote).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(399); });
  expect(api.putNote).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(api.putNote).toHaveBeenCalledTimes(1);
  expect(api.putNote).toHaveBeenCalledWith("secondary", "Secondary draft edited");
  expect(screen.queryByText("saving…")).not.toBeInTheDocument();
  act(() => { for (const view of views) expect(undo(view)).toBe(true); });
  expect(views.map(view => view.state.doc.toString())).toEqual(["Primary draft", "Secondary draft"]);
});
