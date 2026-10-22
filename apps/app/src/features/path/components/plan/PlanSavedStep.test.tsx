import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlanSavedStep } from "./PlanSavedStep";

function renderStep(isToday: boolean) {
  const onViewUpcoming = vi.fn();
  render(
    <PlanSavedStep
      pathName="Edmond run"
      stopCount={3}
      reminderLabel={null}
      isToday={isToday}
      onViewUpcoming={onViewUpcoming}
      onBuildAnother={vi.fn()}
      onDone={vi.fn()}
    />,
  );
  return { onViewUpcoming };
}

describe("PlanSavedStep", () => {
  it("a today save says it is ready to run today and offers View route", () => {
    const { onViewUpcoming } = renderStep(true);
    expect(screen.getByText(/ready to run today/i)).toBeInTheDocument();
    expect(screen.queryByText(/upcoming/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /view route/i }));
    expect(onViewUpcoming).toHaveBeenCalledTimes(1);
  });

  it("a later-day save points to Upcoming", () => {
    renderStep(false);
    expect(screen.getByText("Saved to Upcoming. Open it there anytime.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /view upcoming/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /view route/i })).not.toBeInTheDocument();
  });

  it("has no long dashes in its copy", () => {
    renderStep(false);
    expect(document.body.textContent).not.toMatch(/[–—]/);
  });
});
