import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppointmentsAwaitingCard } from "./AppointmentsAwaitingCard";
import type { AppointmentsAwaitingRollupRow } from "../hooks/useAppointmentsAwaitingRollup";

let rows: AppointmentsAwaitingRollupRow[];
let role: "rep" | "manager" | "admin" | undefined;

vi.mock("../hooks/useAppointmentsAwaitingRollup", () => ({
  useAppointmentsAwaitingRollup: () => ({ rows, isLoading: false }),
}));
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: role ? { role } : null }),
}));

const row = (over: Partial<AppointmentsAwaitingRollupRow> = {}): AppointmentsAwaitingRollupRow => ({
  userId: "u",
  fullName: "Rep",
  awaitingCount: 0,
  ...over,
});

beforeEach(() => {
  rows = [];
  role = "manager";
});

describe("AppointmentsAwaitingCard", () => {
  it("renders nothing for a non-manager", () => {
    role = "rep";
    rows = [row({ awaitingCount: 2 })];
    const { container } = render(<AppointmentsAwaitingCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the profile hasn't loaded yet", () => {
    role = undefined;
    rows = [row({ awaitingCount: 2 })];
    const { container } = render(<AppointmentsAwaitingCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows counts for a manager with awaiting appointments, only for reps with a nonzero count", () => {
    rows = [
      row({ userId: "a", fullName: "Alex", awaitingCount: 3 }),
      row({ userId: "b", fullName: "Sam", awaitingCount: 0 }),
    ];
    render(<AppointmentsAwaitingCard />);
    expect(screen.getByText(/appointments awaiting outcome/i)).toBeInTheDocument();
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("Sam")).not.toBeInTheDocument();
    expect(screen.getByText(/3 total/i)).toBeInTheDocument();
  });

  it("shows an empty-friendly state (no list) when every visible rep has zero awaiting", () => {
    rows = [row({ fullName: "Alex", awaitingCount: 0 }), row({ fullName: "Sam", awaitingCount: 0 })];
    render(<AppointmentsAwaitingCard />);
    expect(screen.getByText(/caught up/i)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("renders nothing when there are no visible reps at all", () => {
    rows = [];
    const { container } = render(<AppointmentsAwaitingCard />);
    expect(container).toBeEmptyDOMElement();
  });
});
