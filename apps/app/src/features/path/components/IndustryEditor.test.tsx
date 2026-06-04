import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IndustryEditor } from "./IndustryEditor";
import { allSubtypes, type IndustrySelection } from "../lib/industrySelection";

const RETAIL_FULL: IndustrySelection = { retail: allSubtypes("retail") };

describe("IndustryEditor", () => {
  it("shows the selected industries with sub-type counts", () => {
    render(<IndustryEditor value={RETAIL_FULL} scope="path" onUseForPath={vi.fn()} onSaveDefault={vi.fn()} />);
    expect(screen.getByText(/retail/i)).toBeInTheDocument();
    const total = allSubtypes("retail").length;
    expect(screen.getByText(new RegExp(`${total} of ${total}`, "i"))).toBeInTheDocument();
  });

  it("path scope: Use for this path returns the current selection", () => {
    const onUseForPath = vi.fn();
    render(<IndustryEditor value={RETAIL_FULL} scope="path" onUseForPath={onUseForPath} onSaveDefault={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /use for this path/i }));
    expect(onUseForPath).toHaveBeenCalledWith(RETAIL_FULL);
  });

  it("path scope: Save as default returns the current selection", () => {
    const onSaveDefault = vi.fn();
    render(<IndustryEditor value={RETAIL_FULL} scope="path" onUseForPath={vi.fn()} onSaveDefault={onSaveDefault} />);
    fireEvent.click(screen.getByRole("button", { name: /save as default/i }));
    expect(onSaveDefault).toHaveBeenCalledWith(RETAIL_FULL);
  });

  it("Add industries reveals a picker of not-yet-selected categories; adding selects all its sub-types", () => {
    const onUseForPath = vi.fn();
    render(<IndustryEditor value={RETAIL_FULL} scope="path" onUseForPath={onUseForPath} onSaveDefault={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add industries/i }));
    fireEvent.click(screen.getByRole("button", { name: /^automotive$/i }));
    fireEvent.click(screen.getByRole("button", { name: /use for this path/i }));
    const arg = onUseForPath.mock.calls[0][0] as IndustrySelection;
    expect(arg.automotive).toEqual(allSubtypes("automotive"));
    expect(arg.retail).toEqual(allSubtypes("retail"));
  });

  it("default scope: shows a single Save action", () => {
    const onSaveDefault = vi.fn();
    render(<IndustryEditor value={RETAIL_FULL} scope="default" onUseForPath={vi.fn()} onSaveDefault={onSaveDefault} />);
    expect(screen.queryByRole("button", { name: /use for this path/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSaveDefault).toHaveBeenCalledWith(RETAIL_FULL);
  });

  it("empty state offers Recommended", () => {
    render(<IndustryEditor value={{}} scope="default" onUseForPath={vi.fn()} onSaveDefault={vi.fn()} />);
    expect(screen.getByRole("button", { name: /use recommended/i })).toBeInTheDocument();
  });
});
