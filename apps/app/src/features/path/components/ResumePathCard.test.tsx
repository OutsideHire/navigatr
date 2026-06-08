import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResumePathCard } from "./ResumePathCard";

describe("ResumePathCard", () => {
  it("shows the pending count and a human date, and fires the handlers", () => {
    const onContinue = vi.fn();
    const onClose = vi.fn();
    render(
      <ResumePathCard pathDate="2026-06-07" pendingCount={6} todayIso="2026-06-08"
        onContinue={onContinue} onClose={onClose} />,
    );
    expect(screen.getByText(/6 stops left/i)).toBeInTheDocument();
    expect(screen.getByText(/yesterday/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue today/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /close it out/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("singularizes one stop and formats older dates", () => {
    render(
      <ResumePathCard pathDate="2026-06-05" pendingCount={1} todayIso="2026-06-08"
        onContinue={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByText(/1 stop left/i)).toBeInTheDocument();
    expect(screen.getByText(/Fri, Jun 5/)).toBeInTheDocument();
  });

  it("disables both actions when disabled", () => {
    render(
      <ResumePathCard pathDate="2026-06-07" pendingCount={2} todayIso="2026-06-08"
        disabled onContinue={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /continue today/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /close it out/i })).toBeDisabled();
  });
});
