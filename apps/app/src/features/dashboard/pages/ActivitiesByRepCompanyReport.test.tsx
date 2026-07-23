import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivitiesByRepCompanyReport } from "./ActivitiesByRepCompanyReport";
import type { RepActivity } from "../lib/repCompanyActivity";

// This project's vitest env doesn't ship a fully-functional jsdom
// localStorage (missing .clear); install an in-memory shim so the
// tip-dismiss persistence test can exercise it (mirrors
// PipelinePage.test.tsx / CookieBanner.test.tsx).
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    value: {
      get length() { return store.size; },
      clear() { store.clear(); },
      getItem(key: string) { return store.has(key) ? store.get(key)! : null; },
      key(i: number) { return Array.from(store.keys())[i] ?? null; },
      removeItem(key: string) { store.delete(key); },
      setItem(key: string, value: string) { store.set(key, value); },
    },
    writable: true,
    configurable: true,
  });
});

const reps: RepActivity[] = [
  { ownerId: "u1", companyCount: 1, counts: { call: 10, email: 2, drop_in: 0, appointment: 0, total: 12 },
    companies: [{ companyName: "Acme", counts: { call: 10, email: 2, drop_in: 0, appointment: 0, total: 12 } }] },
  { ownerId: "u2", companyCount: 1, counts: { call: 1, email: 9, drop_in: 0, appointment: 0, total: 10 },
    companies: [{ companyName: "Beta", counts: { call: 1, email: 9, drop_in: 0, appointment: 0, total: 10 } }] },
];
const grandTotal = { call: 11, email: 11, drop_in: 0, appointment: 0, total: 22 };

let mockProfile: { role_level: string } | null = { role_level: "sales_manager" };
vi.mock("@/features/auth/useProfile", () => ({ useProfile: () => ({ data: mockProfile }) }));
vi.mock("../hooks/useRepCompanyActivity", () => ({
  useRepCompanyActivity: () => ({
    reps, grandTotal, isLoading: false,
    nameOf: (id: string | null) => (id === "u1" ? "Dana W" : id === "u2" ? "Marcus B" : "Unassigned"),
  }),
}));

function renderReport() {
  return render(<MemoryRouter><ActivitiesByRepCompanyReport /></MemoryRouter>);
}

describe("ActivitiesByRepCompanyReport", () => {
  beforeEach(() => { mockProfile = { role_level: "sales_manager" }; localStorage.clear(); });

  it("lists reps ranked by total by default (Dana first)", () => {
    renderReport();
    const rows = screen.getAllByTestId("rep-row");
    expect(within(rows[0]!).getByText("Dana W")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Marcus B")).toBeInTheDocument();
  });

  it("re-sorts when an activity card is clicked (Emails puts Marcus first)", () => {
    renderReport();
    fireEvent.click(screen.getByRole("button", { name: /Emails/i }));
    const cards = screen.getAllByTestId("rep-row");
    expect(within(cards[0]!).getByText("Marcus B")).toBeInTheDocument();
  });

  it("expands a rep to show the company table with a subtotal", () => {
    renderReport();
    fireEvent.click(screen.getByTestId("rep-row-u1"));
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Subtotal")).toBeInTheDocument();
  });

  it("dismisses the tip and persists the choice", () => {
    renderReport();
    expect(screen.getByText(/Tip:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /dismiss tip/i }));
    expect(screen.queryByText(/Tip:/)).not.toBeInTheDocument();
    expect(localStorage.getItem("rca:tipDismissed")).toBe("1");
  });

  it("shows a not-available message for reps", () => {
    mockProfile = { role_level: "sales_professional" };
    renderReport();
    expect(screen.getByText(/not available/i)).toBeInTheDocument();
    expect(screen.queryByText("Dana W")).not.toBeInTheDocument();
  });
});
