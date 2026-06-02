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
});

describe("PathPage location states", () => {
  it("shows a finding-location spinner while geolocation is loading", () => {
    originState.current = { ...base, geoStatus: "loading" };
    render(<PathPage />, { wrapper });
    expect(screen.getByText(/finding your location/i)).toBeInTheDocument();
  });

  it("shows the blocked state (search-first + how-to) when GPS is denied", () => {
    originState.current = { ...base, geoStatus: "denied" };
    render(<PathPage />, { wrapper });
    expect(screen.getByText(/location is blocked/i)).toBeInTheDocument();
    expect(screen.getByText(/how to re-enable location/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/search by city or zip/i)).toBeInTheDocument();
  });

  it("shows a Try again button when location is unavailable", () => {
    originState.current = { ...base, geoStatus: "unavailable" };
    render(<PathPage />, { wrapper });
    expect(screen.getByText(/couldn't get your location/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/how to re-enable location/i)).not.toBeInTheDocument();
  });

  it("renders the page (no empty state) once an origin is set", () => {
    originState.current = {
      ...base, origin: { lat: 40, lng: -105 }, originSource: "gps",
      originLabel: "Current location", geoStatus: "ready",
    };
    render(<PathPage />, { wrapper });
    expect(screen.queryByText(/location is blocked/i)).not.toBeInTheDocument();
  });

  it("shows the discovering spinner when origin is set but merchants are loading", () => {
    originState.current = {
      ...base, origin: { lat: 40, lng: -105 }, originSource: "gps",
      originLabel: "Current location", geoStatus: "ready",
    };
    merchantsState.current = { ...merchantsState.current, isLoading: true };
    render(<PathPage />, { wrapper });
    expect(screen.getByText(/discovering businesses/i)).toBeInTheDocument();
  });

  it("Retry in the merchants-error card refetches the discovery query", () => {
    const refetch = vi.fn();
    originState.current = {
      ...base, origin: { lat: 40, lng: -105 }, originSource: "gps",
      originLabel: "Current location", geoStatus: "ready",
    };
    merchantsState.current = { ...merchantsState.current, isError: true, refetch };
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
