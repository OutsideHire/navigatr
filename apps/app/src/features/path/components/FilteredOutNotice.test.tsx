import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { FilteredOutNotice } from "./FilteredOutNotice";

describe("FilteredOutNotice", () => {
  it("stays silent when nothing was filtered", () => {
    const { container } = render(
      <FilteredOutNotice homeBased={0} chains={0} showing={false} onToggle={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  // An aggressive filter with no way back silently deletes a rep's territory,
  // so the count must always be visible and explained.
  it("names what was hidden, not just how many", () => {
    render(<FilteredOutNotice homeBased={12} chains={3} showing={false} onToggle={() => {}} />);
    expect(screen.getByText(/15 businesses filtered out/i)).toBeInTheDocument();
    expect(screen.getByText(/12 home-based and 3 chains/i)).toBeInTheDocument();
  });

  it("omits a category that hid nothing", () => {
    render(<FilteredOutNotice homeBased={4} chains={0} showing={false} onToggle={() => {}} />);
    expect(screen.getByText(/4 home-based/i)).toBeInTheDocument();
    expect(screen.queryByText(/chain/i)).not.toBeInTheDocument();
  });

  it("singularises a lone chain", () => {
    render(<FilteredOutNotice homeBased={0} chains={1} showing={false} onToggle={() => {}} />);
    expect(screen.getByText(/1 business filtered out/i)).toBeInTheDocument();
    expect(screen.getByText(/1 chain\b/i)).toBeInTheDocument();
  });

  it("lets the rep pull them back, and back out again", async () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <FilteredOutNotice homeBased={5} chains={0} showing={false} onToggle={onToggle} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /show them/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<FilteredOutNotice homeBased={5} chains={0} showing onToggle={onToggle} />);
    expect(screen.getByText(/showing 5 filtered/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hide them/i })).toBeInTheDocument();
  });
});
