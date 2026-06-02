import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
vi.mock("../hooks/useMerchants", async (orig) => {
  const actual = await orig<typeof import("../hooks/useMerchants")>();
  return { ...actual, useMerchants: () => ({ merchants: [], isLoading: false, isError: false, refetch: vi.fn() }) };
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const base: PathOrigin = {
  origin: null, originSource: null, originLabel: null, geoStatus: "loading",
  searching: false, searchError: null, searchLocation: vi.fn(), useMyLocation: vi.fn(),
};

beforeEach(() => { originState.current = base; });

describe("PathPage location states", () => {
  it("shows a finding-location spinner while geolocation is loading", () => {
    originState.current = { ...base, geoStatus: "loading" };
    render(<PathPage />, { wrapper });
    expect(screen.getByText(/finding your location/i)).toBeInTheDocument();
  });

  it("shows an empty state with search when GPS is denied and no manual location", () => {
    originState.current = { ...base, geoStatus: "denied" };
    render(<PathPage />, { wrapper });
    expect(screen.getByText(/don't have your location/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/search by city or zip/i)).toBeInTheDocument();
  });

  it("renders the page (no empty state) once an origin is set", () => {
    originState.current = {
      ...base, origin: { lat: 40, lng: -105 }, originSource: "gps",
      originLabel: "Current location", geoStatus: "ready",
    };
    render(<PathPage />, { wrapper });
    expect(screen.queryByText(/don't have your location/i)).not.toBeInTheDocument();
  });
});
