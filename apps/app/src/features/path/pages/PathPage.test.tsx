import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PathPage } from "./PathPage";
import type { PathOrigin } from "../hooks/usePathOrigin";

// Control the origin layer.
const originState = { current: {} as PathOrigin };
vi.mock("../hooks/usePathOrigin", () => ({
  usePathOrigin: () => originState.current,
}));

// Heavy/irrelevant children — keep the test in jsdom (MerchantMap is MapLibre).
vi.mock("../components/MerchantMap", () => ({ MerchantMap: () => <div data-testid="map" /> }));
vi.mock("../components/MerchantDetailSheet", () => ({ MerchantDetailSheet: () => null }));
vi.mock("../components/PathPlanSheet", () => ({ PathPlanSheet: () => null }));
vi.mock("../components/CreatePathWizard", () => ({ CreatePathWizard: () => null }));
vi.mock("../components/ActivePathView", () => ({ ActivePathView: () => <div data-testid="active-path" /> }));

// No prospects unless origin is set; keep the discovery hook quiet.
const merchantsState = {
  current: { merchants: [], isLoading: false, isError: false, refetch: vi.fn() } as ReturnType<
    typeof import("../hooks/useMerchants")["useMerchants"]
  >,
};
vi.mock("../hooks/useMerchants", async (orig) => {
  const actual = await orig<typeof import("../hooks/useMerchants")>();
  return { ...actual, useMerchants: () => merchantsState.current };
});

// Control todayPath / stops for path-first view tests.
const todayState = {
  current: {
    stops: [] as unknown[],
    add: vi.fn(),
    clear: vi.fn(),
    has: () => false,
    isComplete: () => false,
    setStatus: vi.fn(),
    remove: vi.fn(),
    logVisit: vi.fn(),
    markDealCreated: vi.fn(),
    pathId: null,
    isLoading: false,
  },
};
vi.mock("../hooks/useTodayPath", () => ({ useTodayPath: () => todayState.current }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const base: PathOrigin = {
  origin: null, originSource: null, originLabel: null, geoStatus: "loading",
  searching: false, searchError: null, searchLocation: vi.fn(), useMyLocation: vi.fn(),
};

beforeEach(() => {
  originState.current = base;
  merchantsState.current = { merchants: [], isLoading: false, isError: false, refetch: vi.fn() } as typeof merchantsState.current;
  todayState.current = { ...todayState.current, stops: [] };
});

describe("PathPage location states", () => {
  it("shows a finding-location spinner while geolocation is loading", () => {
    originState.current = { ...base, geoStatus: "loading" };
    render(<PathPage />, { wrapper });
    expect(screen.getByText(/finding your location/i)).toBeInTheDocument();
  });

  it("shows the blocked state with inline re-enable steps when GPS is denied", () => {
    originState.current = { ...base, geoStatus: "denied" };
    render(<PathPage />, { wrapper });
    expect(screen.getByText(/location is blocked/i)).toBeInTheDocument();
    // Steps are shown inline (not behind a disclosure) so a blocked rep sees the fix.
    expect(screen.getByText(/re-enable location/i)).toBeInTheDocument();
    expect(screen.getByText(/set location to/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/search by city or zip/i)).toBeInTheDocument();
  });

  it("shows a Try again button when location is unavailable", () => {
    originState.current = { ...base, geoStatus: "unavailable" };
    render(<PathPage />, { wrapper });
    expect(screen.getByText(/couldn't get your location/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/re-enable location/i)).not.toBeInTheDocument();
  });

  it("renders the page (no empty state) once an origin is set", () => {
    originState.current = {
      ...base, origin: { lat: 40, lng: -105 }, originSource: "gps",
      originLabel: "Current location", geoStatus: "ready",
    };
    render(<PathPage />, { wrapper });
    expect(screen.queryByText(/location is blocked/i)).not.toBeInTheDocument();
  });

  it("defaults to entry cards when origin is set and there are no stops (discovery is no longer the default body)", () => {
    originState.current = {
      ...base, origin: { lat: 40, lng: -105 }, originSource: "gps",
      originLabel: "Current location", geoStatus: "ready",
    };
    // merchantsLoading only renders inside the discover branch; with empty stops the
    // page shows the entry view regardless of loading state.
    merchantsState.current = { ...merchantsState.current, isLoading: true };
    render(<PathPage />, { wrapper });
    expect(screen.getByRole("button", { name: /create a path/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /plan a path/i })).toBeInTheDocument();
    expect(screen.queryByText(/location is blocked/i)).not.toBeInTheDocument();
  });

  it("does not show the discover-branch merchants-error card by default", () => {
    originState.current = {
      ...base, origin: { lat: 40, lng: -105 }, originSource: "gps",
      originLabel: "Current location", geoStatus: "ready",
    };
    // The Retry button lives in the merchants-error card inside the discover branch.
    // With empty stops the page lands on entry view, so the error card never renders.
    merchantsState.current = { ...merchantsState.current, isError: true, refetch: vi.fn() };
    render(<PathPage />, { wrapper });
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("entering discover via Plan shows the discovery loading state", () => {
    originState.current = { ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready" };
    todayState.current = { ...todayState.current, stops: [] };
    merchantsState.current = { merchants: [], isLoading: true, isError: false, refetch: vi.fn() };
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /plan a path/i }));
    expect(screen.getByText(/discovering businesses/i)).toBeInTheDocument();
  });
});

describe("PathPage path-first view states", () => {
  it("shows the two-card entry when origin is set and there is no active path", () => {
    todayState.current = { ...todayState.current, stops: [] };
    originState.current = { ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready" };
    render(<PathPage />, { wrapper });
    expect(screen.getByRole("button", { name: /create a path/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /plan a path/i })).toBeInTheDocument();
  });

  it("shows the active path view when today's path has stops", () => {
    todayState.current = { ...todayState.current, stops: [{ merchantId: "m1" }] };
    originState.current = { ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready" };
    render(<PathPage />, { wrapper });
    expect(screen.getByTestId("active-path")).toBeInTheDocument();
  });
});
