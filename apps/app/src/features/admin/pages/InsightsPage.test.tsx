import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { InsightsPage } from "./InsightsPage";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});
// The lost-reason widget makes a network read; stub it so the page renders
// deterministically and this test focuses on the reports hub.
vi.mock("../hooks/useLostReasonRollup", () => ({
  useLostReasonRollup: () => ({ data: [], isLoading: false, error: null }),
  LOST_REASON_LABELS: {},
}));

beforeEach(() => navigateMock.mockReset());

function renderPage() {
  render(<MemoryRouter><InsightsPage /></MemoryRouter>);
}

describe("InsightsPage reports hub", () => {
  it("surfaces the three deep reports as links", () => {
    renderPage();
    expect(screen.getByRole("link", { name: /activity-to-win/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /persistence index/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /lead source performance/i })).toBeInTheDocument();
  });

  it("navigates to each report's route on click", () => {
    renderPage();
    fireEvent.click(screen.getByRole("link", { name: /activity-to-win/i }));
    expect(navigateMock).toHaveBeenCalledWith("/dashboard/activity-to-win");

    fireEvent.click(screen.getByRole("link", { name: /persistence index/i }));
    expect(navigateMock).toHaveBeenCalledWith("/dashboard/persistence-index");

    fireEvent.click(screen.getByRole("link", { name: /lead source performance/i }));
    expect(navigateMock).toHaveBeenCalledWith("/dashboard/lead-source");
  });

  it("still shows the lost-deals section", () => {
    renderPage();
    expect(screen.getByText(/lost deals/i)).toBeInTheDocument();
  });
});
