import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdditionalReports } from "./DashboardPage";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});
// AdditionalReports now gates a second row on the manager capability, so it
// reads the profile. Default to no profile (gate off) to preserve this
// file's original rep-facing assertions unchanged.
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => ({ data: null }) }));

beforeEach(() => navigateMock.mockReset());

describe("AdditionalReports", () => {
  it("shows an Activities Report entry", () => {
    render(<MemoryRouter><AdditionalReports /></MemoryRouter>);
    expect(screen.getByText("Activities Report")).toBeInTheDocument();
    expect(screen.getByText(/Closed Won/i)).toBeInTheDocument();
  });

  it("navigates to the report when clicked", () => {
    render(<MemoryRouter><AdditionalReports /></MemoryRouter>);
    fireEvent.click(screen.getByText("Activities Report"));
    expect(navigateMock).toHaveBeenCalledWith("/dashboard/activity-to-win");
  });
});
