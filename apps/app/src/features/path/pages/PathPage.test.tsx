import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { PathPage } from "./PathPage";
import type { PathOrigin } from "../hooks/usePathOrigin";

// Control the origin layer.
const originState = { current: {} as PathOrigin };
vi.mock("../hooks/usePathOrigin", () => ({
  usePathOrigin: () => originState.current,
}));

// Sonner toasts — assert success/warning/error feedback without a real toaster.
// vi.hoisted so the reference is initialized before the hoisted vi.mock factory runs.
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

// Spy on the O(n²) nearest-neighbor pass so we can assert it only runs in the
// discover view (the route-memo guard). Wraps the real impl so routePath still
// computes correctly. vi.hoisted so it's initialized before the mock factory.
const nearestNeighborSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/distance", async (orig) => {
  const actual = await orig<typeof import("@/lib/distance")>();
  return {
    ...actual,
    nearestNeighborOrder: (...args: Parameters<typeof actual.nearestNeighborOrder>) => {
      nearestNeighborSpy();
      return actual.nearestNeighborOrder(...args);
    },
  };
});

// Heavy/irrelevant children — keep the test in jsdom (MerchantMap is MapLibre).
// Expose whether a routePath polyline was handed in, for the discover-route test.
vi.mock("../components/MerchantMap", () => ({
  MerchantMap: (props: { routePath?: unknown }) => (
    <div data-testid="map" data-has-route={props.routePath ? "yes" : "no"} />
  ),
}));
vi.mock("../components/MerchantDetailSheet", () => ({ MerchantDetailSheet: () => null }));
// Capture the wizard's onStart so tests can drive handleStartPath directly.
let capturedOnStart: ((ids: string[]) => void | Promise<void>) | null = null;
vi.mock("../components/CreatePathWizard", () => ({
  CreatePathWizard: (props: { onStart?: (ids: string[]) => void | Promise<void> }) => {
    capturedOnStart = props.onStart ?? null;
    return null;
  },
}));
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
    addMany: vi.fn(),
    clear: vi.fn(),
    has: () => false,
    isComplete: () => false,
    setStatus: vi.fn(),
    remove: vi.fn(),
    logVisit: vi.fn(),
    markDealCreated: vi.fn(),
    pathId: null,
    isLoading: false,
    pendingCount: () => 0,
  },
};
vi.mock("../hooks/useTodayPath", () => ({ useTodayPath: () => todayState.current }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const base: PathOrigin = {
  origin: null, originSource: null, originLabel: null, geoStatus: "loading",
  searching: false, searchError: null, searchLocation: vi.fn(), useMyLocation: vi.fn(),
};

beforeEach(() => {
  originState.current = base;
  merchantsState.current = { merchants: [], isLoading: false, isError: false, refetch: vi.fn() } as typeof merchantsState.current;
  todayState.current = { ...todayState.current, stops: [], addMany: vi.fn(), clear: vi.fn() };
  toastMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  capturedOnStart = null;
  nearestNeighborSpy.mockClear();
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

  it("hides the manual City/ZIP search once an origin is set (kept only for the no-origin recovery path)", () => {
    originState.current = {
      ...base, origin: { lat: 40, lng: -105 }, originSource: "gps",
      originLabel: "Current location", geoStatus: "ready",
    };
    render(<PathPage />, { wrapper });
    expect(screen.queryByLabelText(/search by city or zip/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Showing:/)).not.toBeInTheDocument();
  });

  it("still shows the City/ZIP search when there is no origin (e.g. GPS blocked) so the rep can get unstuck", () => {
    originState.current = { ...base, geoStatus: "denied" };
    render(<PathPage />, { wrapper });
    expect(screen.getByLabelText(/search by city or zip/i)).toBeInTheDocument();
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

describe("PathPage route memos — discover-only", () => {
  const readyOrigin: PathOrigin = {
    ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready",
  };
  const geoStops = [
    { merchantId: "a", name: "Alpha", address: "1 A St", lat: 30.05, lng: -97.05, category: "retail", status: "pending" },
    { merchantId: "b", name: "Bravo", address: "2 B St", lat: 30.06, lng: -97.06, category: "retail", status: "pending" },
  ];
  const liveMerchant = [
    { id: "x", name: "Xray", address: "9 X St", phone: null, lat: 30.04, lng: -97.04, category: "retail", primaryType: null },
  ] as unknown as typeof merchantsState.current.merchants;

  it("does NOT run nearest-neighbor ordering outside the discover view (active view with stops)", () => {
    originState.current = readyOrigin;
    todayState.current = { ...todayState.current, stops: geoStops as unknown as typeof todayState.current.stops };
    render(<PathPage />, { wrapper });
    // Stops present → lands on the active home, not discover.
    expect(screen.getByTestId("active-path")).toBeInTheDocument();
    // The route memo must short-circuit when pathView !== "discover".
    expect(nearestNeighborSpy).not.toHaveBeenCalled();
  });

  it("still builds the route polyline for the discover map (no regression)", () => {
    originState.current = readyOrigin;
    merchantsState.current = { merchants: liveMerchant, isLoading: false, isError: false, refetch: vi.fn() } as typeof merchantsState.current;
    todayState.current = { ...todayState.current, stops: [] };
    const { rerender } = render(<PathPage />, { wrapper });
    // Enter discover from the entry view, then stops arrive (sticky discover).
    fireEvent.click(screen.getByRole("button", { name: /plan a path/i }));
    todayState.current = { ...todayState.current, stops: geoStops as unknown as typeof todayState.current.stops };
    rerender(<PathPage />);
    const map = screen.getByTestId("map");
    expect(map).toHaveAttribute("data-has-route", "yes");
    expect(nearestNeighborSpy).toHaveBeenCalled();
  });
});

describe("PathPage handleStartPath — dropped stops", () => {
  const readyOrigin: PathOrigin = {
    ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready",
  };
  // Minimal live merchants — only the fields handleStartPath snapshots.
  const liveMerchants = [
    { id: "a", name: "Alpha", address: "1 A St", phone: null, lat: 30.1, lng: -97.1, category: "retail", primaryType: null },
    { id: "b", name: "Bravo", address: "2 B St", phone: null, lat: 30.2, lng: -97.2, category: "retail", primaryType: null },
  ] as unknown as typeof merchantsState.current.merchants;

  beforeEach(() => {
    originState.current = readyOrigin;
    merchantsState.current = { merchants: liveMerchants, isLoading: false, isError: false, refetch: vi.fn() } as typeof merchantsState.current;
  });

  it("warns via toast when some selected stops aren't in the live merchant set", async () => {
    render(<PathPage />, { wrapper });
    expect(capturedOnStart).toBeTypeOf("function");
    // "c" is not in liveMerchants (e.g. radius tightened mid-wizard) → 1 dropped.
    await act(async () => { await capturedOnStart!(["a", "c", "b"]); });

    expect(todayState.current.addMany).toHaveBeenCalledTimes(1);
    expect(todayState.current.addMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ prospectId: "a" }),
        expect.objectContaining({ prospectId: "b" }),
      ]),
    );
    expect((todayState.current.addMany as ReturnType<typeof vi.fn>).mock.calls[0][0]).toHaveLength(2);
    expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/1 stop.*couldn't be added/i));
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("does NOT warn when every selected stop resolves", async () => {
    render(<PathPage />, { wrapper });
    await act(async () => { await capturedOnStart!(["a", "b"]); });

    expect(todayState.current.addMany).toHaveBeenCalledTimes(1);
    expect(toastMock).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});
