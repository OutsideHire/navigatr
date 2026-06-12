import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EndRouteSheet } from "./EndRouteSheet";

const base = { open: true, onOpenChange: vi.fn(), pendingCount: 6, onCarry: vi.fn(), onClear: vi.fn() };

describe("EndRouteSheet", () => {
  it("shows the pending count and fires Carry / Clear", () => {
    const onCarry = vi.fn();
    const onClear = vi.fn();
    render(<EndRouteSheet {...base} onCarry={onCarry} onClear={onClear} />);
    expect(screen.getByText(/6 stops left/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /carry 6 to tomorrow/i }));
    expect(onCarry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /clear & start over/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
  it("Cancel closes the sheet", () => {
    const onOpenChange = vi.fn();
    render(<EndRouteSheet {...base} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it("disables the actions while busy", () => {
    render(<EndRouteSheet {...base} busy />);
    expect(screen.getByRole("button", { name: /carry 6 to tomorrow/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /clear & start over/i })).toBeDisabled();
  });
  it("singularizes one stop", () => {
    render(<EndRouteSheet {...base} pendingCount={1} />);
    expect(screen.getByText(/1 stop left/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /carry 1 to tomorrow/i })).toBeInTheDocument();
  });
});
