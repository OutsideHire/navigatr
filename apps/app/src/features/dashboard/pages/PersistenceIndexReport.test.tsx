import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PersistenceIndexReport } from "./PersistenceIndexReport";
import type { PersistencePoint } from "../lib/persistenceIndex";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

let role: "rep" | "manager" | "admin" = "rep";
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => ({ data: { role } }) }));

let series: PersistencePoint[];
let lastRangeDays = 0;
vi.mock("../hooks/usePersistenceHistory", () => ({
  usePersistenceHistory: (rangeDays: number) => {
    lastRangeDays = rangeDays;
    return series;
  },
}));

function mkSeries(n: number, base = 60): PersistencePoint[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-06-${String((i % 28) + 1).padStart(2, "0")}`,
    composite: base + (i % 10),
    activityCount: i % 4,
  }));
}

function renderReport() {
  return render(
    <MemoryRouter initialEntries={["/dashboard/persistence-index"]}>
      <PersistenceIndexReport />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigateMock.mockReset();
  role = "rep";
  series = mkSeries(30);
});

describe("PersistenceIndexReport", () => {
  it("renders the title, a back link, and the range pills", () => {
    renderReport();
    expect(screen.getByRole("heading", { name: /persistence index/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^1M$/ })).toBeInTheDocument();
  });

  it("defaults to the 1M range and switches when a pill is clicked", () => {
    renderReport();
    expect(lastRangeDays).toBe(30);
    fireEvent.click(screen.getByRole("button", { name: /^3M$/ }));
    expect(lastRangeDays).toBe(90);
  });

  it("renders the trend chart as an SVG when there is data", () => {
    const { container } = renderReport();
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("shows the empty state when every point is null", () => {
    series = mkSeries(30).map((p) => ({ ...p, composite: null }));
    renderReport();
    expect(screen.getByText(/not enough data/i)).toBeInTheDocument();
  });

  it("back link navigates to the dashboard", () => {
    renderReport();
    fireEvent.click(screen.getByRole("button", { name: /dashboard/i }));
    expect(navigateMock).toHaveBeenCalledWith("/dashboard");
  });
});
