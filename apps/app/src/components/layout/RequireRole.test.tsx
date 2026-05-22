import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import { RequireRole } from "./RequireRole";

let profileRole: "rep" | "manager" | "admin" | undefined;
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({
    data: profileRole ? { role: profileRole } : null,
    isLoading: profileRole === undefined ? true : false,
    isFetching: false,
    isError: false,
  }),
}));

function renderAt(initial: string, allow: Array<"rep" | "manager" | "admin">) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/admin" element={<RequireRole allow={allow}><div>admin-content</div></RequireRole>} />
        <Route path="/dashboard" element={<div>dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireRole", () => {
  it("renders children when role is in allow list", () => {
    profileRole = "manager";
    renderAt("/admin", ["manager", "admin"]);
    expect(screen.getByText("admin-content")).toBeInTheDocument();
  });

  it("redirects to /dashboard when role is NOT in allow list", () => {
    profileRole = "rep";
    renderAt("/admin", ["manager", "admin"]);
    expect(screen.queryByText("admin-content")).not.toBeInTheDocument();
    expect(screen.getByText("dashboard")).toBeInTheDocument();
  });

  it("renders a spinner while profile is loading", () => {
    profileRole = undefined;
    renderAt("/admin", ["manager", "admin"]);
    expect(screen.queryByText("admin-content")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard")).not.toBeInTheDocument();
  });
});
