import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LocationSearch } from "./LocationSearch";

describe("LocationSearch", () => {
  it("calls onSearch with the typed query on submit", () => {
    const onSearch = vi.fn();
    render(<LocationSearch onSearch={onSearch} searching={false} error={null} />);
    fireEvent.change(screen.getByPlaceholderText(/city or zip/i), {
      target: { value: "Austin, TX" },
    });
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(onSearch).toHaveBeenCalledWith("Austin, TX");
  });

  it("does not call onSearch for a blank query", () => {
    const onSearch = vi.fn();
    render(<LocationSearch onSearch={onSearch} searching={false} error={null} />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("disables the button while searching", () => {
    render(<LocationSearch onSearch={vi.fn()} searching error={null} />);
    expect(screen.getByRole("button", { name: /search/i })).toBeDisabled();
  });

  it("renders the error message when provided", () => {
    render(<LocationSearch onSearch={vi.fn()} searching={false} error="No match — try a city or ZIP" />);
    expect(screen.getByText(/no match/i)).toBeInTheDocument();
  });

  it("focuses the input on mount when autoFocus is set", () => {
    render(<LocationSearch onSearch={vi.fn()} searching={false} error={null} autoFocus />);
    expect(screen.getByLabelText(/search by city or zip/i)).toHaveFocus();
  });

  it("does not focus the input when autoFocus is not set", () => {
    render(<LocationSearch onSearch={vi.fn()} searching={false} error={null} />);
    expect(screen.getByLabelText(/search by city or zip/i)).not.toHaveFocus();
  });
});
