import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChoosePathMode } from "./ChoosePathMode";

describe("ChoosePathMode", () => {
  it("renders both mode cards", () => {
    render(<ChoosePathMode mode={null} onSelect={vi.fn()} />);
    expect(screen.getByText("Create a Path")).toBeInTheDocument();
    expect(screen.getByText("Plan a Path")).toBeInTheDocument();
  });

  it("selecting Create fires onSelect('create')", () => {
    const onSelect = vi.fn();
    render(<ChoosePathMode mode={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Create a Path"));
    expect(onSelect).toHaveBeenCalledWith("create");
  });

  it("selecting Plan fires onSelect('plan')", () => {
    const onSelect = vi.fn();
    render(<ChoosePathMode mode={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Plan a Path"));
    expect(onSelect).toHaveBeenCalledWith("plan");
  });

  it("marks the selected card via aria-pressed", () => {
    render(<ChoosePathMode mode="plan" onSelect={vi.fn()} />);
    const planButton = screen.getByText("Plan a Path").closest("button")!;
    const createButton = screen.getByText("Create a Path").closest("button")!;
    expect(planButton).toHaveAttribute("aria-pressed", "true");
    expect(createButton).toHaveAttribute("aria-pressed", "false");
  });
});
