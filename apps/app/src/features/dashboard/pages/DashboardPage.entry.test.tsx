import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdditionalReports } from "./DashboardPage";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

// AdditionalReports renders only the manager-only "Activity performance"
// entry, pointing at the unified report's "all" scope; the Closed-Won
// analysis lives on the Activity-to-Win widget, so it is no longer
// duplicated here. Toggle the role to exercise both paths.
let mockRoleLevel: string | null = "sales_manager";
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: mockRoleLevel ? { role_level: mockRoleLevel } : null }),
}));

beforeEach(() => {
  navigateMock.mockReset();
  mockRoleLevel = "sales_manager";
});

describe("AdditionalReports", () => {
  it("no longer shows the redundant Closed-Won Activities Report entry", () => {
    render(<MemoryRouter><AdditionalReports /></MemoryRouter>);
    expect(screen.queryByText("Activities Report")).not.toBeInTheDocument();
    expect(screen.queryByText(/Closed Won/i)).not.toBeInTheDocument();
  });

  it("shows the Activity performance entry for managers and navigates to it", () => {
    render(<MemoryRouter><AdditionalReports /></MemoryRouter>);
    fireEvent.click(screen.getByText("Activity-To-Win"));
    expect(navigateMock).toHaveBeenCalledWith("/dashboard/activity-to-win?scope=all");
  });

  it("renders nothing for a non-manager (no empty card)", () => {
    mockRoleLevel = null;
    const { container } = render(<MemoryRouter><AdditionalReports /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
