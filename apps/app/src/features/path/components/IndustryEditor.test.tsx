import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IndustryEditor } from "./IndustryEditor";
import { allSubtypes, humanizeSubtype, type IndustrySelection } from "../lib/industrySelection";

const RETAIL_FULL: IndustrySelection = { general_merchandise: allSubtypes("general_merchandise") };
const RETAIL_PARTIAL: IndustrySelection = { general_merchandise: allSubtypes("general_merchandise").slice(0, 1) };

describe("IndustryEditor", () => {
  it("shows the selected industries with sub-type counts", () => {
    render(<IndustryEditor value={RETAIL_FULL} scope="path" onUseForPath={vi.fn()} onSaveDefault={vi.fn()} />);
    expect(screen.getByText(/general merchandise/i)).toBeInTheDocument();
    const total = allSubtypes("general_merchandise").length;
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
    expect(arg.general_merchandise).toEqual(allSubtypes("general_merchandise"));
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

  it("X button removes a category from the selection", () => {
    const onUseForPath = vi.fn();
    render(<IndustryEditor value={RETAIL_FULL} scope="path" onUseForPath={onUseForPath} onSaveDefault={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /remove general merchandise/i }));
    fireEvent.click(screen.getByRole("button", { name: /use for this path/i }));
    expect(onUseForPath).toHaveBeenCalledWith({});
  });

  it("expanding a partial category and checking a sub-type adds it and updates the count", () => {
    const onUseForPath = vi.fn();
    render(<IndustryEditor value={RETAIL_PARTIAL} scope="path" onUseForPath={onUseForPath} onSaveDefault={vi.fn()} />);
    const total = allSubtypes("general_merchandise").length;
    fireEvent.click(screen.getByRole("button", { name: /toggle general merchandise sub-types/i }));
    // check a sub-type that is not the first (the unchecked add branch)
    const second = allSubtypes("general_merchandise")[1];
    fireEvent.click(screen.getByLabelText(new RegExp(`^${humanizeSubtype(second)}$`, "i")));
    expect(screen.getByText(new RegExp(`2 of ${total}`, "i"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /use for this path/i }));
    const arg = onUseForPath.mock.calls[0][0];
    expect(arg.general_merchandise).toContain(second);
  });

  it("unchecking the last sub-type removes the category", () => {
    const onSaveDefault = vi.fn();
    render(<IndustryEditor value={RETAIL_PARTIAL} scope="default" onUseForPath={vi.fn()} onSaveDefault={onSaveDefault} />);
    fireEvent.click(screen.getByRole("button", { name: /toggle general merchandise sub-types/i }));
    const first = allSubtypes("general_merchandise")[0];
    fireEvent.click(screen.getByLabelText(new RegExp(`^${humanizeSubtype(first)}$`, "i")));
    // category card gone → empty state appears
    expect(screen.getByRole("button", { name: /use recommended/i })).toBeInTheDocument();
  });
});
