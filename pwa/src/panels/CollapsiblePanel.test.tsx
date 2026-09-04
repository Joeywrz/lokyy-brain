import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CollapsiblePanel, type PanelSide } from "./CollapsiblePanel.js";
afterEach(cleanup);
it.each<PanelSide>(["left", "right", "top", "bottom"])("keeps the open %s panel inside its allotted width", side => {
  render(<CollapsiblePanel id={`test-${side}`} title="Panel" side={side} defaultOpen><div>Long heading</div></CollapsiblePanel>);
  expect(screen.getByRole("region", { name: "Panel" })).toHaveStyle({ maxWidth: "100%", minWidth: "0px", boxSizing: "border-box" });
});
