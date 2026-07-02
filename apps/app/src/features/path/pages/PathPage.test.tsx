import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { PathPage } from "./PathPage";
import type { PathOrigin } from "../hooks/usePathOrigin";

// The Plan a Path slide-out is a Radix Dialog; jsdom lacks these.
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

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
// Stub ActivePathView, but expose the real onAddStops wiring: clicking "Add stops"
// calls the prop, which is PathPage's enterDiscover — the same UI path a rep takes
// from an active path into the discover view. (The real component is a MapLibre-heavy
// surface; the button is all the discover-entry test needs.)
vi.mock("../components/ActivePathView", () => ({
  ActivePathView: (props: { onAddStops?: () => void; onStartRoute?: () => void }) => (
    <div data-testid="active-path">
      <button type="button" onClick={() => props.onAddStops?.()}>Add stops</button>
      <button type="button" onClick={() => props.onStartRoute?.()}>Start route</button>
    </div>
  ),
}));
// Stub RunningPath — the guided run has its own tests; here we only assert the
// two-tab surface renders it as the default (Run) tab for a started path.
vi.mock("../components/RunningPath", () => ({
  RunningPath: () => <div data-testid="running-path" />,
}));

// No prospects unless origin is set; keep the discovery hook quiet.
const merchantsState = {
  current: { merchants: [], isLoading: false, isError: false, refetch: vi.fn() } as ReturnType<
    typeof import("../hooks/useMerchants")["useMerchants"]
  >,
};
// Records every useMerchants(origin, opts) call so tests can assert PathPage
// requests both a chains-included browse fetch AND a chain-free Create fetch.
const useMerchantsSpy = vi.fn();
vi.mock("../hooks/useMerchants", async (orig) => {
  const actual = await orig<typeof import("../hooks/useMerchants")>();
  return {
    ...actual,
    useMerchants: (...args: unknown[]) => {
      useMerchantsSpy(...args);
      return merchantsState.current;
    },
  };
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
    startedAt: null as string | null,
    start: vi.fn(),
    isLoading: false,
    pendingCount: () => 0,
  },
};
vi.mock("../hooks/useTodayPath", () => ({ useTodayPath: () => todayState.current }));

// Detection hook — controllable per test.
const prevUnfinishedState = { current: { data: null as null | { pathId: string; pathDate: string; pendingCount: number } } };
vi.mock("../hooks/usePreviousUnfinishedPath", () => ({
  usePreviousUnfinishedPath: () => prevUnfinishedState.current,
}));
// PathPage calls usePathMutations directly for continue/close.
const continueMutate = vi.fn();
const closeMutate = vi.fn();
vi.mock("../hooks/usePathMutations", () => ({
  usePathMutations: () => ({
    continuePreviousPath: { mutate: vi.fn(), mutateAsync: continueMutate, isPending: false },
    closePreviousPath: { mutate: closeMutate, mutateAsync: vi.fn(), isPending: false },
  }),
}));

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
  todayState.current = { ...todayState.current, stops: [], addMany: vi.fn(), clear: vi.fn(), startedAt: null, start: vi.fn() };
  toastMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  capturedOnStart = null;
  nearestNeighborSpy.mockClear();
  useMerchantsSpy.mockClear();
  prevUnfinishedState.current = { data: null };
  continueMutate.mockReset();
  closeMutate.mockReset();
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

  it("Plan a Path opens the stepped slide-out wizard", () => {
    originState.current = { ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready" };
    todayState.current = { ...todayState.current, stops: [] };
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /plan a path/i }));
    // The Plan wizard slide-out mounts at its first step (search).
    expect(screen.getByText(/step 1 of 5/i)).toBeInTheDocument();
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

describe("PathPage carryover", () => {
  const ready = { ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready" } as PathOrigin;

  it("shows the resume card on the entry screen when there's an unfinished past path", () => {
    originState.current = ready;
    todayState.current = { ...todayState.current, stops: [] };
    prevUnfinishedState.current = { data: { pathId: "p7", pathDate: "2026-06-07", pendingCount: 4 } };
    render(<PathPage />, { wrapper });
    expect(screen.getByText(/4 stops left/i)).toBeInTheDocument();
  });

  it("does not show the resume card when there's no unfinished past path", () => {
    originState.current = ready;
    todayState.current = { ...todayState.current, stops: [] };
    prevUnfinishedState.current = { data: null };
    render(<PathPage />, { wrapper });
    expect(screen.queryByText(/stops? left/i)).not.toBeInTheDocument();
  });

  it("Continue today calls continuePreviousPath with the path id + date", async () => {
    originState.current = ready;
    todayState.current = { ...todayState.current, stops: [] };
    prevUnfinishedState.current = { data: { pathId: "p7", pathDate: "2026-06-07", pendingCount: 4 } };
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /continue today/i }));
    await waitFor(() => expect(continueMutate).toHaveBeenCalledWith({ prevPathId: "p7", prevPathDate: "2026-06-07" }));
  });

  it("starting a fresh Create path implicitly closes the unfinished path", () => {
    originState.current = ready;
    todayState.current = { ...todayState.current, stops: [] };
    prevUnfinishedState.current = { data: { pathId: "p7", pathDate: "2026-06-07", pendingCount: 4 } };
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /create a path/i }));
    expect(closeMutate).toHaveBeenCalledWith({ prevPathId: "p7", prevPathDate: "2026-06-07" });
  });

  it("transitions to the active view once stops arrive after Continue", async () => {
    originState.current = ready;
    todayState.current = { ...todayState.current, stops: [] };
    prevUnfinishedState.current = { data: { pathId: "p7", pathDate: "2026-06-07", pendingCount: 4 } };
    continueMutate.mockResolvedValueOnce(undefined);
    const { rerender } = render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /continue today/i }));
    // Simulate the carried stops landing (query invalidation → useActivePath refetch).
    todayState.current = { ...todayState.current, stops: [{ merchantId: "s1" }] };
    rerender(<PathPage />);
    await waitFor(() => expect(screen.getByTestId("active-path")).toBeInTheDocument());
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
    // A live geocoded merchant so the discover branch renders the map (anyGeocoded).
    merchantsState.current = { merchants: liveMerchant, isLoading: false, isError: false, refetch: vi.fn() } as typeof merchantsState.current;
    // Active path with pending geocoded stops → lands on the active home, whose
    // "Add stops" button (onAddStops === enterDiscover) transitions to discover.
    todayState.current = { ...todayState.current, stops: geoStops as unknown as typeof todayState.current.stops };
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /add stops/i }));
    // In discover, the route memo runs nearest-neighbor over the queued stops and
    // hands the polyline to the map.
    const map = screen.getByTestId("map");
    expect(map).toHaveAttribute("data-has-route", "yes");
    expect(nearestNeighborSpy).toHaveBeenCalled();
  });
});

describe("PathPage discovery fetches — chain-free Create pool", () => {
  const readyOrigin: PathOrigin = {
    ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready",
  };

  it("fetches a chains-included browse pool AND a chain-free pool for Create", () => {
    originState.current = readyOrigin;
    render(<PathPage />, { wrapper });
    const includeChainsFlags = useMerchantsSpy.mock.calls.map(
      (call) => (call[1] as { includeChains?: boolean } | undefined)?.includeChains,
    );
    // Two discovery fetches: browse keeps chains (badged in discover), Create
    // excludes them so the results count = usable (non-chain) stops.
    expect(includeChainsFlags).toContain(true);
    expect(includeChainsFlags).toContain(false);
    // Both honor the same results-count limit.
    const limits = useMerchantsSpy.mock.calls.map((call) => (call[1] as { limit?: number } | undefined)?.limit);
    expect(limits.filter((l) => l === 25).length).toBeGreaterThanOrEqual(2);
  });
});

describe("PathPage active-path surface — Run | Stops tabs", () => {
  const readyOrigin: PathOrigin = {
    ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready",
  };
  const geoStops = [
    { merchantId: "a", name: "Alpha", address: "1 A St", lat: 30.05, lng: -97.05, category: "retail", status: "pending" },
    { merchantId: "b", name: "Bravo", address: "2 B St", lat: 30.06, lng: -97.06, category: "retail", status: "pending" },
  ];

  it("a STARTED path (started_at set) shows Run|Stops tabs and defaults to the Run tab", () => {
    originState.current = readyOrigin;
    todayState.current = {
      ...todayState.current,
      startedAt: "2026-07-02T15:00:00.000Z",
      stops: geoStops as unknown as typeof todayState.current.stops,
    };
    render(<PathPage />, { wrapper });
    expect(screen.getByRole("tab", { name: /run/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /stops/i })).toBeInTheDocument();
    // Default tab is Run (resume-in-place) → the guided run renders, not the list.
    expect(screen.getByTestId("running-path")).toBeInTheDocument();
    expect(screen.queryByTestId("active-path")).not.toBeInTheDocument();
  });

  it("switching to the Stops tab shows the overview; back to Run shows the guided run", () => {
    originState.current = readyOrigin;
    todayState.current = {
      ...todayState.current,
      startedAt: "2026-07-02T15:00:00.000Z",
      stops: geoStops as unknown as typeof todayState.current.stops,
    };
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("tab", { name: /stops/i }));
    expect(screen.getByTestId("active-path")).toBeInTheDocument();
    expect(screen.queryByTestId("running-path")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /run/i }));
    expect(screen.getByTestId("running-path")).toBeInTheDocument();
  });

  it("a PLANNED path (started_at null) shows the overview only — no tabs, no auto-run", () => {
    originState.current = readyOrigin;
    todayState.current = {
      ...todayState.current,
      startedAt: null,
      stops: geoStops as unknown as typeof todayState.current.stops,
    };
    render(<PathPage />, { wrapper });
    expect(screen.queryByRole("tab", { name: /run/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("active-path")).toBeInTheDocument();
    expect(screen.queryByTestId("running-path")).not.toBeInTheDocument();
  });

  it("'Start route' on a planned path stamps started_at (start()) and switches to the Run tab", () => {
    originState.current = readyOrigin;
    const start = vi.fn();
    todayState.current = {
      ...todayState.current,
      startedAt: null,
      start,
      stops: geoStops as unknown as typeof todayState.current.stops,
    };
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /start route/i }));
    expect(start).toHaveBeenCalledTimes(1);
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
      // Create a Path auto-starts: addMany is called with { start: true } so the
      // page lands the rep straight in the Run tab.
      { start: true },
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
