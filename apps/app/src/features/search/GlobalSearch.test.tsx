// GlobalSearch — the TopBar palette. Verifies grouped rendering, click + keyboard
// navigation, and the empty state. useGlobalSearch is mocked so we drive the UI
// directly (its own logic is covered in useGlobalSearch.test).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { GlobalSearch, flattenResults } from "./GlobalSearch";
import type { GlobalSearchResults } from "./useGlobalSearch";

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigateMock }));

let hookReturn: { results: GlobalSearchResults; isLoading: boolean; isEnabled: boolean };
vi.mock("./useGlobalSearch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useGlobalSearch")>();
  return { ...actual, useGlobalSearch: () => hookReturn };
});

const RESULTS: GlobalSearchResults = {
  deals: [{ kind: "deal", id: "d1", label: "Acme Co", sublabel: "Al · New", to: "/pipeline/d1" }],
  partners: [{ kind: "partner", id: "p1", label: "First Bank", sublabel: "First Bank NA", to: "/partners/p1" }],
  activities: [{ kind: "activity", id: "a1", label: "Call: Acme Co", sublabel: "left a voicemail", to: "/pipeline/d9" }],
};

beforeEach(() => {
  navigateMock.mockClear();
  hookReturn = { results: RESULTS, isLoading: false, isEnabled: true };
});

const type = (v: string) =>
  fireEvent.change(screen.getByRole("combobox"), { target: { value: v } });

describe("flattenResults", () => {
  it("orders deals, then partners, then activities", () => {
    expect(flattenResults(RESULTS).map((r) => r.id)).toEqual(["d1", "p1", "a1"]);
  });
});

describe("GlobalSearch", () => {
  it("renders grouped results after typing", () => {
    render(<GlobalSearch />);
    type("acme");
    const list = screen.getByRole("listbox");
    expect(within(list).getByText("Deals")).toBeInTheDocument();
    expect(within(list).getByText("Partners")).toBeInTheDocument();
    expect(within(list).getByText("Activities")).toBeInTheDocument();
    expect(within(list).getByText("Acme Co")).toBeInTheDocument();
    expect(within(list).getByText("First Bank")).toBeInTheDocument();
  });

  it("navigates to a result's route on click", () => {
    render(<GlobalSearch />);
    type("bank");
    fireEvent.click(screen.getByText("First Bank"));
    expect(navigateMock).toHaveBeenCalledWith("/partners/p1");
  });

  it("moves the highlight with ArrowDown and opens it on Enter", () => {
    render(<GlobalSearch />);
    const input = screen.getByRole("combobox");
    type("acme");
    // Down once → index 1 (First Bank), Enter opens it.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigateMock).toHaveBeenCalledWith("/partners/p1");
  });

  it("Enter with no movement opens the first result", () => {
    render(<GlobalSearch />);
    const input = screen.getByRole("combobox");
    type("acme");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigateMock).toHaveBeenCalledWith("/pipeline/d1");
  });

  it("shows an empty state when a valid search has no matches", () => {
    hookReturn = { results: { deals: [], partners: [], activities: [] }, isLoading: false, isEnabled: true };
    render(<GlobalSearch />);
    type("zzz");
    expect(screen.getByText(/no matches for/i)).toBeInTheDocument();
  });

  it("closes the panel on Escape", () => {
    render(<GlobalSearch />);
    const input = screen.getByRole("combobox");
    type("acme");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
