import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdditionalReports } from "./DashboardPage";

let role: string = "sales_manager";
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => ({ data: { role_level: role } }) }));

describe("AdditionalReports rep-and-company entry", () => {
  it("shows the entry for managers", () => {
    role = "sales_manager";
    render(
      <MemoryRouter>
        <AdditionalReports />
      </MemoryRouter>,
    );
    expect(screen.getByText("Activity-To-Win")).toBeInTheDocument();
  });

  it("hides the entry for reps", () => {
    role = "sales_professional";
    render(
      <MemoryRouter>
        <AdditionalReports />
      </MemoryRouter>,
    );
    expect(screen.queryByText("Activity-To-Win")).not.toBeInTheDocument();
  });
});
