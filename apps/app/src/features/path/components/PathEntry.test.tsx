import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PathEntry } from "./PathEntry";

describe("PathEntry", () => {
  it("offers Create and Plan, wired to their handlers", () => {
    const onCreate = vi.fn(); const onPlan = vi.fn();
    render(<PathEntry onCreate={onCreate} onPlan={onPlan} />);
    fireEvent.click(screen.getByRole("button", { name: /create a path/i }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /plan a path/i }));
    expect(onPlan).toHaveBeenCalledTimes(1);
  });

  it("explains each option", () => {
    render(<PathEntry onCreate={vi.fn()} onPlan={vi.fn()} />);
    expect(screen.getByText(/from your current location/i)).toBeInTheDocument();
    expect(screen.getByText(/search by city or zip/i)).toBeInTheDocument();
  });
});
