import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PipelineFilterPopover } from "./PipelineFilterPopover";
import { EMPTY_DEAL_FILTERS } from "../lib/filterDeals";

// Radix Popover needs these in jsdom:
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  }
});

describe("PipelineFilterPopover", () => {
  it("shows a count badge when active and none when empty", () => {
    const { rerender } = render(<PipelineFilterPopover filters={EMPTY_DEAL_FILTERS} onChange={vi.fn()} />);
    expect(screen.queryByTestId("filter-count")).toBeNull();
    rerender(<PipelineFilterPopover filters={{ ...EMPTY_DEAL_FILTERS, minProbability: 50 }} onChange={vi.fn()} />);
    expect(screen.getByTestId("filter-count")).toHaveTextContent("1");
  });
  it("opening + clicking 'Has follow-up' calls onChange with followUp:has", () => {
    const onChange = vi.fn();
    render(<PipelineFilterPopover filters={EMPTY_DEAL_FILTERS} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("button", { name: /has follow-up/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ followUp: "has" }));
  });
  it("Clear resets to empty", () => {
    const onChange = vi.fn();
    render(<PipelineFilterPopover filters={{ ...EMPTY_DEAL_FILTERS, minProbability: 50 }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith(EMPTY_DEAL_FILTERS);
  });
  it("min value: typing a dollar amount calls onChange with correct cents", () => {
    const onChange = vi.fn();
    render(<PipelineFilterPopover filters={EMPTY_DEAL_FILTERS} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "500" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ minValueCents: 50000 }));
  });
  it("min value: clearing the input sets minValueCents to null", () => {
    const onChange = vi.fn();
    render(<PipelineFilterPopover filters={{ ...EMPTY_DEAL_FILTERS, minValueCents: 50000 }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ minValueCents: null }));
  });
});
