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
// DayStopsMap (the Today's Path List/Map map view) is also MapLibre; stub it so
// the landing renders in jsdom without a WebGL context.
vi.mock("../components/DayStopsMap", () => ({
  DayStopsMap: (props: { stops?: unknown[] }) => (
    <div data-testid="day-stops-map" data-stops={props.stops?.length ?? 0} />
  ),
}));
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
// two-tab surface renders it as the default (Run) tab for a started path, and
// capture the onFindNearby prop so the discover-glue test can assert PathPage
// wired it to enterDiscover.
let capturedOnFindNearby: (() => void) | null = null;
vi.mock("../components/RunningPath", () => ({
  RunningPath: (props: { onFindNearby?: () => void }) => {
    capturedOnFindNearby = props.onFindNearby ?? null;
    return <div data-testid="running-path" />;
  },
}));

// No prospects unless origin is set; keep the discovery hook quiet.
type UseMerchantsFull = ReturnType<typeof import("../hooks/useMerchants")["useMerchants"]>;
// The fill/transparency fields (hidden, effectiveRadiusM, requestedRadiusM,
// requestedLimit) are optional in the mock so the existing terse literals stay
// valid; PathPage reads them defensively (undefined -> no shortfall hint).
type UseMerchantsMock = Omit<
  UseMerchantsFull,
  "hidden" | "effectiveRadiusM" | "requestedRadiusM" | "requestedLimit"
> &
  Partial<Pick<UseMerchantsFull, "hidden" | "effectiveRadiusM" | "requestedRadiusM" | "requestedLimit">>;
const merchantsState = {
  current: { merchants: [], isLoading: false, isError: false, refetch: vi.fn() } as UseMerchantsMock,
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

// Auto-built Today's Path (SP-B2). Mocked so the entry landing's TodaysPathView
// renders from a controllable proposal WITHOUT the real hook firing its four tier
// sub-hooks (useMeetingStops/useOwedVisits/useDueTodayVisits/useMerchants) in
// jsdom. Default: empty proposal → the "all caught up / find nearby" empty state,
// under which the demoted Create/Plan actions still render.
const todaysPathState = {
  current: {
    proposal: [] as unknown[],
    overflow: [] as unknown[],
    noLocation: [] as unknown[],
    startsAt: null as string | null,
    status: "ok" as string,
    isLoading: false,
  },
};
vi.mock("../hooks/useTodaysPath", () => ({ useTodaysPath: () => todaysPathState.current }));

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
// Calendar + geolocation drive the run overlay only. Default to "not connected"
// / no fix so the meeting-aware overlay is null and the existing assertions
// (which never touch the calendar) are unaffected. RunningPath is stubbed above,
// so nothing renders the overlay here anyway — these mocks just keep PathPage's
// new live read from firing a real Edge Function / geolocation request in jsdom.
const calendarState = {
  current: {
    waypoints: [] as unknown[],
    timeBlocks: [] as unknown[],
    status: "not_connected" as string,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
};
vi.mock("../hooks/useCalendarEvents", () => ({
  useCalendarEvents: () => calendarState.current,
}));

// Saved default industries (usePathPreferences). Controllable per test so we can
// assert PathPage seeds the discover ingest from the rep's saved set (or falls
// back to "all" when none are saved). Default: undefined (still loading) so the
// existing tests never see a seed and behave exactly as before.
import type { IndustrySelection } from "../lib/industrySelection";
import { RECOMMENDED_SELECTION, selectedCategories } from "../lib/industrySelection";
const pathPrefsState = { current: { data: undefined as IndustrySelection | undefined } };
vi.mock("../hooks/usePathPreferences", () => ({
  usePathPreferences: () => pathPrefsState.current,
  // PathSettings (rendered by PathPage) also pulls the update mutation from here.
  useUpdateDefaultIndustries: () => ({ mutateAsync: vi.fn(), isPending: false }),
  // useTodaysPath reads the per-rep end-of-day; null -> global default window.
  usePathEndOfDayMinutes: () => ({ data: null }),
  // PathSettings also owns the end-of-day save control.
  useUpdateEndOfDayMinutes: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../hooks/useGeolocation", () => ({
  useGeolocation: () => ({ coords: null, status: "denied", error: null, retry: vi.fn() }),
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
  todaysPathState.current = { proposal: [], overflow: [], noLocation: [], startsAt: null, status: "ok", isLoading: false };
  continueMutate.mockReset();
  closeMutate.mockReset();
  capturedOnFindNearby = null;
  calendarState.current = {
    waypoints: [], timeBlocks: [], status: "not_connected",
    isLoading: false, isError: false, refetch: vi.fn(),
  };
  pathPrefsState.current = { data: undefined };
});

describe("PathPage location states", () => {
  it("shows a finding-location spinner while geolocation is loading", () => {
    originState.current = { ...base, geoStatus: "loading" };
    render(<PathPage />, { wrapper });
    expect(screen.getByText(/finding your location/i)).toBeInTheDocument();
  });

  it("does NOT show the empty 'all caught up' day while geolocation is still resolving (Path QA B1)", () => {
    // Regression guard for "empty until refresh": with no origin yet and location
    // still resolving, useTodaysPath reports an empty, not-loading proposal (its
    // no-origin contract). The landing must render the finding-location loader,
    // NOT the empty day state, so a rep who does have appointments/owed drop-ins
    // never sees a false "all caught up" during the origin-pending window. (The
    // default todaysPathState here is exactly that empty, not-loading proposal.)
    originState.current = { ...base, geoStatus: "loading" };
    render(<PathPage />, { wrapper });
    expect(screen.getByText(/finding your location/i)).toBeInTheDocument();
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/today's path/i)).not.toBeInTheDocument();
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
    // Entry landing: the header "+" overflow is present and the discover-only
    // "Discovering businesses nearby" spinner is not.
    expect(screen.getByRole("button", { name: /more path actions/i })).toBeInTheDocument();
    expect(screen.queryByText(/discovering businesses nearby/i)).not.toBeInTheDocument();
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

  it("Plan a new area (from the + overflow) opens the stepped slide-out wizard", () => {
    originState.current = { ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready" };
    todayState.current = { ...todayState.current, stops: [] };
    render(<PathPage />, { wrapper });
    // Plan moved off the landing and into the header "+" overflow sheet.
    fireEvent.click(screen.getByRole("button", { name: /more path actions/i }));
    fireEvent.click(screen.getByRole("button", { name: /plan a new area/i }));
    // The Plan wizard slide-out mounts at its first step (search).
    expect(screen.getByText(/step 1 of 5/i)).toBeInTheDocument();
  });
});

describe("PathPage path-first view states", () => {
  it("exposes the relocated Plan / Find-near-me actions via the header + overflow", () => {
    todayState.current = { ...todayState.current, stops: [] };
    originState.current = { ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready" };
    render(<PathPage />, { wrapper });
    // The internal names are gone from the landing; the rarely-used actions live
    // behind the header "+" overflow now.
    expect(screen.queryByRole("button", { name: /create a path/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /plan a path/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /more path actions/i }));
    expect(screen.getByRole("button", { name: /add more stops today/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /plan a new area/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /who's near me right now/i })).toBeInTheDocument();
  });

  it("shows the active path view when today's path has stops", () => {
    todayState.current = { ...todayState.current, stops: [{ merchantId: "m1" }] };
    originState.current = { ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready" };
    render(<PathPage />, { wrapper });
    expect(screen.getByTestId("active-path")).toBeInTheDocument();
  });
});

describe("PathPage landing header actions: redundant buttons hidden", () => {
  const readyOrigin: PathOrigin = {
    ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready",
  };

  it("hides the Plan ahead / Create path / Re-center header buttons on the entry landing (the proposal + '+' overflow own those actions)", () => {
    originState.current = readyOrigin;
    todayState.current = { ...todayState.current, stops: [] };
    render(<PathPage />, { wrapper });
    // The discover-only header buttons are hidden on the landing (the overflow
    // sheet that carries "Plan a new area" is closed by default, so it's absent too).
    expect(screen.queryByRole("button", { name: /^plan a new area$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^start a path$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /re-center|use my location/i })).not.toBeInTheDocument();
    // The rep-facing internal names are gone from the landing entirely.
    expect(screen.queryByRole("button", { name: /create a path/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /plan a path/i })).not.toBeInTheDocument();
  });

  it("still shows those header buttons on the discover/browse view", () => {
    originState.current = readyOrigin;
    // A live geocoded merchant so the discover branch renders, plus an active
    // path whose "Add stops" button transitions into discover.
    merchantsState.current = {
      merchants: [
        { id: "x", name: "Xray", address: "9 X St", phone: null, lat: 30.04, lng: -97.04, category: "retail", primaryType: null },
      ] as unknown as typeof merchantsState.current.merchants,
      isLoading: false, isError: false, refetch: vi.fn(),
    } as typeof merchantsState.current;
    todayState.current = {
      ...todayState.current,
      stops: [
        { merchantId: "a", name: "Alpha", address: "1 A St", lat: 30.05, lng: -97.05, category: "retail", status: "pending" },
      ] as unknown as typeof todayState.current.stops,
    };
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /add stops/i }));
    // Plain rep-facing labels (FR-PATH-UX-13): no internal feature names on the
    // discover surface either, since a rep reaches it via "Who's near me right now".
    expect(screen.getByRole("button", { name: /^plan a new area$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^start a path$/i })).toBeInTheDocument();
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

  it("starting a fresh Plan (from the + overflow) implicitly closes the unfinished path", () => {
    originState.current = ready;
    todayState.current = { ...todayState.current, stops: [] };
    prevUnfinishedState.current = { data: { pathId: "p7", pathDate: "2026-06-07", pendingCount: 4 } };
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /more path actions/i }));
    fireEvent.click(screen.getByRole("button", { name: /plan a new area/i }));
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

describe("PathPage discovery fetches — chain-free everywhere", () => {
  const readyOrigin: PathOrigin = {
    ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready",
  };

  it("never requests chains: every discovery fetch is chain-free", () => {
    originState.current = readyOrigin;
    render(<PathPage />, { wrapper });
    const includeChainsFlags = useMerchantsSpy.mock.calls.map(
      (call) => (call[1] as { includeChains?: boolean } | undefined)?.includeChains,
    );
    // Chains are excluded from all Path discovery (browse + Create), org-wide.
    expect(includeChainsFlags.length).toBeGreaterThan(0);
    expect(includeChainsFlags.every((f) => f === false)).toBe(true);
    // Both honor the same results-count limit.
    const limits = useMerchantsSpy.mock.calls.map((call) => (call[1] as { limit?: number } | undefined)?.limit);
    expect(limits.filter((l) => l === 25).length).toBeGreaterThanOrEqual(2);
  });
});

describe("PathPage active-run surface — card-first, no tabs (v2.2 A7)", () => {
  const readyOrigin: PathOrigin = {
    ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready",
  };
  const geoStops = [
    { merchantId: "a", name: "Alpha", address: "1 A St", lat: 30.05, lng: -97.05, category: "retail", status: "pending" },
    { merchantId: "b", name: "Bravo", address: "2 B St", lat: 30.06, lng: -97.06, category: "retail", status: "pending" },
  ];

  it("a STARTED path (started_at set) renders the guided run directly with NO Run|Stops tablist", () => {
    originState.current = readyOrigin;
    todayState.current = {
      ...todayState.current,
      startedAt: "2026-07-02T15:00:00.000Z",
      stops: geoStops as unknown as typeof todayState.current.stops,
    };
    render(<PathPage />, { wrapper });
    // The Run/Stops tablist is gone (A7): the card-first RunningPath is the surface.
    expect(screen.queryByRole("tab", { name: /^run$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^stops$/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("running-path")).toBeInTheDocument();
    expect(screen.queryByTestId("active-path")).not.toBeInTheDocument();
  });

  it("wires RunningPath's onFindNearby to the discover view", () => {
    originState.current = readyOrigin;
    todayState.current = {
      ...todayState.current,
      startedAt: "2026-07-02T15:00:00.000Z",
      stops: geoStops as unknown as typeof todayState.current.stops,
    };
    render(<PathPage />, { wrapper });
    // RunningPath is the run surface and receives an onFindNearby.
    expect(screen.getByTestId("running-path")).toBeInTheDocument();
    expect(typeof capturedOnFindNearby).toBe("function");
    // Invoking it opens the discover surface (enterDiscover), replacing the run.
    // The secondary discover action is "Next" (Path QA R4) whenever the queue has
    // stops; its presence confirms the discover surface is showing.
    act(() => capturedOnFindNearby!());
    expect(screen.queryByTestId("running-path")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^next$/i })).toBeInTheDocument();
  });

  it("a PLANNED path (started_at null) shows the overview only — no run, no tabs", () => {
    originState.current = readyOrigin;
    todayState.current = {
      ...todayState.current,
      startedAt: null,
      stops: geoStops as unknown as typeof todayState.current.stops,
    };
    render(<PathPage />, { wrapper });
    expect(screen.queryByRole("tab", { name: /^run$/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("active-path")).toBeInTheDocument();
    expect(screen.queryByTestId("running-path")).not.toBeInTheDocument();
  });

  it("'Start route' on a planned path stamps started_at (start()), which flips to the run surface", () => {
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

describe("PathPage discover — meeting-aware banner + fit flags", () => {
  const readyOrigin: PathOrigin = {
    ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready",
  };
  // A nearby geocoded live merchant so the discover list renders it (and the map,
  // via anyGeocoded). The fit flags are computed over this `sorted` list.
  const nearbyMerchant = [
    { id: "x", name: "Xray", address: "9 X St", phone: null, lat: 30.02, lng: -97.02, category: "retail", primaryType: null },
  ] as unknown as typeof merchantsState.current.merchants;
  // An active (planned) path with a pending geocoded stop → lands on the active
  // home whose "Add stops" button (onAddStops === enterDiscover) enters discover.
  const geoStops = [
    { merchantId: "a", name: "Alpha", address: "1 A St", lat: 30.05, lng: -97.05, category: "retail", status: "pending" },
  ];

  function enterDiscover() {
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /add stops/i }));
  }

  it("renders the banner + 'won't fit' flag when the calendar is connected with a soon, far meeting", () => {
    originState.current = readyOrigin;
    merchantsState.current = { merchants: nearbyMerchant, isLoading: false, isError: false, refetch: vi.fn() } as typeof merchantsState.current;
    todayState.current = { ...todayState.current, stops: geoStops as unknown as typeof todayState.current.stops };
    // ONE future located meeting ~40 min out, far from the nearby merchant: the
    // merchant→meeting drive (hundreds of miles at 30mph) blows past the 40-min
    // window, so the drop-in can't fit. Relative-to-now start keeps it future
    // regardless of the wall-clock time the suite runs at.
    calendarState.current = {
      waypoints: [
        {
          id: "cal1", title: "Acme sync",
          start: new Date(Date.now() + 40 * 60000).toISOString(),
          end: new Date(Date.now() + 100 * 60000).toISOString(),
          address: "Far Away", lat: 31.5, lng: -98.5, source: "calendar",
        },
      ],
      timeBlocks: [],
      status: "ok",
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    enterDiscover();
    // Banner (real DiscoverMeetingBanner) shows the meeting title.
    expect(screen.getByText(/Acme sync/)).toBeInTheDocument();
    // The nearby merchant's row (real MerchantList) carries the unfit flag.
    expect(screen.getByText(/won't fit before/i)).toBeInTheDocument();
  });

  it("shows no banner and no fit flag when the calendar is not connected (default)", () => {
    originState.current = readyOrigin;
    merchantsState.current = { merchants: nearbyMerchant, isLoading: false, isError: false, refetch: vi.fn() } as typeof merchantsState.current;
    todayState.current = { ...todayState.current, stops: geoStops as unknown as typeof todayState.current.stops };
    // calendarState stays at the beforeEach default: status "not_connected".
    enterDiscover();
    expect(screen.queryByText(/min until/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/won't fit before/i)).not.toBeInTheDocument();
  });

  it("does not crash (and flags nothing) when a discover merchant has non-finite coords", () => {
    // Regression: discoverUnfit iterates `sorted` and calls fitsBeforeMeeting,
    // which for a non-finite coord drives driveMinutesBetween -> NaN -> new
    // Date(NaN).toISOString(), throwing a RangeError. Because that runs in a
    // render-time useMemo it crashed the ENTIRE discover view, not just the row.
    // The guard (Number.isFinite lat/lng — the same convention MerchantMap and
    // the distance code use over this SAME `sorted` array) leaves such a merchant
    // unflagged instead of crashing.
    //
    // A finite sibling would flip `anyGeocoded` true and the non-finite row would
    // be radius-filtered out of `sorted` before it ever reached discoverUnfit — so
    // to actually exercise the guarded path the non-finite merchant must be the
    // only (un-geocoded) row.
    originState.current = readyOrigin;
    merchantsState.current = {
      merchants: [
        { id: "nan1", name: "No Coords Co", address: "0 Void St", phone: null, lat: NaN, lng: NaN, category: "retail", primaryType: null },
      ] as unknown as typeof merchantsState.current.merchants,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as typeof merchantsState.current;
    todayState.current = { ...todayState.current, stops: geoStops as unknown as typeof todayState.current.stops };
    // A future located meeting → discoverNextMeeting is non-null, so discoverUnfit
    // actually runs its filter over `sorted` (which holds the non-finite merchant).
    calendarState.current = {
      waypoints: [
        {
          id: "cal1", title: "Acme sync",
          start: new Date(Date.now() + 40 * 60000).toISOString(),
          end: new Date(Date.now() + 100 * 60000).toISOString(),
          address: "Far Away", lat: 31.5, lng: -98.5, source: "calendar",
        },
      ],
      timeBlocks: [],
      status: "ok",
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    // Before the guard this render throws RangeError; the render succeeding IS the
    // core regression assertion.
    enterDiscover();
    // The non-finite merchant still renders in the list, just unflagged.
    expect(screen.getByText("No Coords Co")).toBeInTheDocument();
    expect(screen.queryByText(/won't fit before/i)).not.toBeInTheDocument();
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

describe("PathPage handleStartTodaysPath (only nearby tier persists)", () => {
  const readyOrigin: PathOrigin = {
    ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready",
  };
  // The nearby stop's id is a real prospects.id; the owed / due-today stops carry
  // TASK ids that do NOT exist in prospects (path_stops.prospect_id FK).
  const flexible = (over: Record<string, unknown>) => ({
    kind: "flexible", name: "Stop", dealId: null, startAt: null, endAt: null, ageDays: null, ...over,
  });

  beforeEach(() => {
    originState.current = readyOrigin;
    // liveMerchants carries the nearby prospect so the snapshot enriches from it.
    merchantsState.current = {
      merchants: [
        { id: "prospect-1", name: "Nearby Co", address: "9 N St", phone: null, lat: 30.1, lng: -97.1, category: "retail", primaryType: null },
      ] as unknown as typeof merchantsState.current.merchants,
      isLoading: false, isError: false, refetch: vi.fn(),
    } as typeof merchantsState.current;
  });

  it("persists ONLY the nearby stop (task-id owed/due-today stops are never sent to addMany)", async () => {
    // Proposal has a past-due (task id), a due-today (task id), and a nearby
    // (real prospect id). Before the fix, ALL THREE were mapped into snapshots,
    // sending task ids into path_stops.prospect_id → FK violation on a real DB.
    todaysPathState.current = {
      proposal: [
        flexible({ id: "task-1", tier: "past_due", name: "Owed Co", dealId: "deal-1", lat: 30.05, lng: -97.05, ageDays: 5 }),
        flexible({ id: "task-2", tier: "due_today", name: "Due Today Co", dealId: "deal-2", lat: 30.06, lng: -97.06 }),
        flexible({ id: "prospect-1", tier: "nearby", name: "Nearby Co", lat: 30.1, lng: -97.1 }),
      ] as unknown[],
      overflow: [], noLocation: [], startsAt: null, status: "ok", isLoading: false,
    };
    render(<PathPage />, { wrapper });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start driving/i }));
    });

    expect(todayState.current.addMany).toHaveBeenCalledTimes(1);
    const sent = (todayState.current.addMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{ prospectId: string }>;
    // Only the nearby prospect id, no task ids.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ prospectId: "prospect-1" });
    expect(sent.map((s) => s.prospectId)).not.toContain("task-1");
    expect(sent.map((s) => s.prospectId)).not.toContain("task-2");
    // Auto-starts, and never surfaces the failure toast for a mixed proposal.
    expect(todayState.current.addMany).toHaveBeenCalledWith(expect.anything(), { start: true });
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("starts the day gracefully when only live tiers exist (no nearby to persist, no false error)", async () => {
    // Owed + due-today only: nothing to persist as a path_stop, but the day is
    // still meaningful. Stamp started_at via start(); do not send task ids to
    // addMany and do not show a "nothing to start" / error toast.
    todaysPathState.current = {
      proposal: [
        flexible({ id: "task-1", tier: "past_due", name: "Owed Co", dealId: "deal-1", lat: 30.05, lng: -97.05, ageDays: 5 }),
        flexible({ id: "task-2", tier: "due_today", name: "Due Today Co", dealId: "deal-2", lat: 30.06, lng: -97.06 }),
      ] as unknown[],
      overflow: [], noLocation: [], startsAt: null, status: "ok", isLoading: false,
    };
    render(<PathPage />, { wrapper });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start driving/i }));
    });

    expect(todayState.current.addMany).not.toHaveBeenCalled();
    expect(todayState.current.start).toHaveBeenCalledTimes(1);
    expect(toastMock).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("starts an appointment-only day (no flexible stops) and enters the run view", async () => {
    // A day with ONLY appointments has no flexible stops to persist, but the run
    // view drives the appointments live (useDrivingSequence). Start must stamp
    // started_at (start()) and flip to the running surface — not toast "nothing
    // to start" and stay on the landing.
    const appt = {
      id: "appt-1", kind: "appointment", tier: "appointment", name: "Renewal review",
      dealId: "deal-1", lat: 30.2, lng: -97.2,
      startAt: "2026-08-10T17:30:00Z", endAt: "2026-08-10T18:00:00Z", ageDays: null,
    };
    todaysPathState.current = {
      proposal: [appt] as unknown[],
      overflow: [], noLocation: [], startsAt: null, status: "ok", isLoading: false,
    };
    // start() stamps started_at so the view-transition + landing derive the run.
    todayState.current.start = vi.fn(() => {
      todayState.current.startedAt = "2026-08-10T17:00:00Z";
    });

    render(<PathPage />, { wrapper });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start driving/i }));
    });

    // No merchant stops to persist; the day starts via start(), no false error.
    expect(todayState.current.addMany).not.toHaveBeenCalled();
    expect(todayState.current.start).toHaveBeenCalledTimes(1);
    expect(toastMock).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    // The running surface is now on screen (started_at set, run tab).
    await waitFor(() => expect(screen.getByTestId("running-path")).toBeInTheDocument());
  });
});

describe("PathPage discover header — trimmed on mobile (Path QA C1)", () => {
  const readyOrigin: PathOrigin = {
    ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready",
  };
  // A live geocoded merchant + an active path so "Add stops" enters discover.
  const liveMerchant = [
    { id: "x", name: "Xray", address: "9 X St", phone: null, lat: 30.04, lng: -97.04, category: "retail", primaryType: null },
  ] as unknown as typeof merchantsState.current.merchants;

  function enterDiscover() {
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /add stops/i }));
  }

  beforeEach(() => {
    originState.current = readyOrigin;
    merchantsState.current = { merchants: liveMerchant, isLoading: false, isError: false, refetch: vi.fn() } as typeof merchantsState.current;
    todayState.current = {
      ...todayState.current,
      stops: [
        { merchantId: "a", name: "Alpha", address: "1 A St", lat: 30.05, lng: -97.05, category: "retail", status: "pending" },
      ] as unknown as typeof todayState.current.stops,
    };
  });

  it("hides 'Plan a new area' on mobile via a responsive class, keeping it inline at md+", () => {
    enterDiscover();
    const plan = screen.getByRole("button", { name: /^plan a new area$/i });
    // hidden below md, re-shown as inline-flex at md+ (desktop unchanged).
    expect(plan).toHaveClass("hidden");
    expect(plan).toHaveClass("md:inline-flex");
  });

  it("keeps the primary 'Start a path', the location control, and settings visible on discover", () => {
    enterDiscover();
    // Start a path (primary) is NOT gated behind the mobile-hide.
    const start = screen.getByRole("button", { name: /^start a path$/i });
    expect(start).not.toHaveClass("hidden");
    // Re-center / Use my location remains present.
    expect(screen.getByRole("button", { name: /re-center|use my location/i })).toBeInTheDocument();
    // Settings gear remains present.
    expect(screen.getByRole("button", { name: /path settings/i })).toBeInTheDocument();
  });
});

describe("PathPage discover industries — seeded from saved prefs (Path QA C2)", () => {
  const readyOrigin: PathOrigin = {
    ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready",
  };

  beforeEach(() => {
    originState.current = readyOrigin;
  });

  // PathPage's OWN discover browse fetch is the only useMerchants call that omits
  // `fillToLimit` (the Create + Plan wizard fetches always pass it). Selecting the
  // latest such call isolates the ingest that ingestIndustries/ingestAllIndustries
  // drive, so we don't false-match PlanPathWizard's independent RECOMMENDED fetch.
  type IngestOpts = { industries?: string[]; allIndustries?: boolean; fillToLimit?: boolean };
  const latestBrowseOpts = (): IngestOpts | undefined => {
    const browse = useMerchantsSpy.mock.calls
      .map((call) => call[1] as IngestOpts | undefined)
      .filter((opts): opts is IngestOpts => !!opts && !("fillToLimit" in opts));
    return browse[browse.length - 1];
  };

  it("seeds the browse fetch from the rep's saved default industries (allIndustries false)", async () => {
    // Saved set: retail + healthcare fully selected. Discover must fetch those
    // buckets, not an empty industry list.
    pathPrefsState.current = {
      data: { retail: ["convenience_store"], healthcare: ["dentist"] } as IndustrySelection,
    };
    render(<PathPage />, { wrapper });
    await waitFor(() => {
      const opts = latestBrowseOpts();
      expect(opts?.allIndustries).toBe(false);
      expect(opts?.industries).toEqual(expect.arrayContaining(["retail", "healthcare"]));
    });
  });

  it("seeds the browse fetch from the recommended set when the rep has no saved industries", async () => {
    // usePathPreferences substitutes RECOMMENDED_SELECTION when the rep has saved
    // nothing, so the hook never returns an empty set. A no-saved rep is therefore
    // seeded to the recommended industries (relevant defaults), allIndustries false,
    // not raw "all". (The all-industries else branch is a defensive fallback only,
    // unreachable via the real hook.)
    pathPrefsState.current = { data: RECOMMENDED_SELECTION };
    render(<PathPage />, { wrapper });
    await waitFor(() => {
      const opts = latestBrowseOpts();
      expect(opts?.allIndustries).toBe(false);
      expect(opts?.industries).toEqual(
        expect.arrayContaining(selectedCategories(RECOMMENDED_SELECTION)),
      );
    });
  });
});

describe("PathPage discover — one-tap Start path (Path QA C3)", () => {
  const readyOrigin: PathOrigin = {
    ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready",
  };
  // The queued stop's merchantId matches a live merchant id so handleStartPath
  // resolves it into a snapshot (it resolves ids against the browse/create set).
  const liveMerchants = [
    { id: "a", name: "Alpha", address: "1 A St", phone: null, lat: 30.05, lng: -97.05, category: "retail", primaryType: null },
  ] as unknown as typeof merchantsState.current.merchants;

  beforeEach(() => {
    originState.current = readyOrigin;
    merchantsState.current = { merchants: liveMerchants, isLoading: false, isError: false, refetch: vi.fn() } as typeof merchantsState.current;
    todayState.current = {
      ...todayState.current,
      stops: [
        { merchantId: "a", name: "Alpha", address: "1 A St", lat: 30.05, lng: -97.05, category: "retail", status: "pending" },
      ] as unknown as typeof todayState.current.stops,
    };
  });

  // A queued path renders ActivePathView, whose "Add stops" enters discover.
  function enterDiscoverWithStops() {
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /add stops/i }));
  }

  it("starts the run immediately from the queued stops (clear + addMany { start: true }), skipping the wizard", async () => {
    enterDiscoverWithStops();
    // The wizard's onStart is captured, but the one-tap Start must NOT go through
    // the wizard — it reuses handleStartPath directly on the queued stops.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^start path$/i }));
    });
    // Reuses handleStartPath's exact create+start mechanism.
    expect(todayState.current.clear).toHaveBeenCalledTimes(1);
    expect(todayState.current.addMany).toHaveBeenCalledTimes(1);
    expect(todayState.current.addMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ prospectId: "a" })]),
      { start: true },
    );
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("does not show the Start path control when there are no queued stops", () => {
    // Empty queue → the entry landing renders; "Build my day" opens discover with
    // an empty queue, where the one-tap Start must be hidden (only "Done" remains).
    todayState.current = { ...todayState.current, stops: [] as unknown as typeof todayState.current.stops };
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /build my day/i }));
    expect(screen.queryByRole("button", { name: /^start path$/i })).not.toBeInTheDocument();
    // The secondary back action reads "Done" (not "Back to path") on an empty queue.
    expect(screen.getByRole("button", { name: /^done$/i })).toBeInTheDocument();
  });
});

describe("PathPage discover — action bar reachable on mobile (Path QA C4)", () => {
  const readyOrigin: PathOrigin = {
    ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready",
  };
  const liveMerchants = [
    { id: "a", name: "Alpha", address: "1 A St", phone: null, lat: 30.05, lng: -97.05, category: "retail", primaryType: null },
  ] as unknown as typeof merchantsState.current.merchants;

  beforeEach(() => {
    originState.current = readyOrigin;
    merchantsState.current = { merchants: liveMerchants, isLoading: false, isError: false, refetch: vi.fn() } as typeof merchantsState.current;
    todayState.current = {
      ...todayState.current,
      stops: [
        { merchantId: "a", name: "Alpha", address: "1 A St", lat: 30.05, lng: -97.05, category: "retail", status: "pending" },
      ] as unknown as typeof todayState.current.stops,
    };
  });

  it("wraps the discover actions in a sticky, scroll-safe footer so they stay reachable on short screens", () => {
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /add stops/i }));
    const start = screen.getByRole("button", { name: /^start path$/i });
    const bar = start.closest('[data-testid="discover-action-bar"]');
    expect(bar).not.toBeNull();
    // Pinned to the bottom of the fixed-height page column (sticky bottom-0) with a
    // solid background + top border; a regression that moves it out fails here.
    expect(bar).toHaveClass("sticky");
    expect(bar).toHaveClass("bottom-0");
  });
});

describe("PathPage discover — added stops appear on return without a refresh (Path QA R4)", () => {
  const readyOrigin: PathOrigin = {
    ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready",
  };
  // A geocoded live merchant so the discover branch renders.
  const liveMerchants = [
    { id: "a", name: "Alpha", address: "1 A St", phone: null, lat: 30.05, lng: -97.05, category: "retail", primaryType: null },
  ] as unknown as typeof merchantsState.current.merchants;

  beforeEach(() => {
    originState.current = readyOrigin;
    merchantsState.current = { merchants: liveMerchants, isLoading: false, isError: false, refetch: vi.fn() } as typeof merchantsState.current;
  });

  it("returns to the active path (reflecting the just-added stop) when the rep taps Next, WITHOUT a manual refresh", () => {
    // The reported bug: from discover ("Add nearby") the rep adds a stop, then taps
    // "Next" to go back to the path — but the newly added stop does NOT show on the
    // path until a manual reload. Root cause: handleDoneDiscovering bounced to
    // "entry" and depended on the queueStops-length sync effect to upgrade to
    // "path"; once the added stop has already landed in the cache (the common fast
    // case), that effect's deps no longer change on the view switch, so the rep is
    // stranded on the entry/proposal view. Only a reload re-runs the mount effect.
    //
    // Start on the empty entry landing (no stops), enter discover, then simulate the
    // add landing (useActivePath refetch grows the stops), then tap Next.
    todayState.current = { ...todayState.current, stops: [] as unknown as typeof todayState.current.stops };
    const { rerender } = render(<PathPage />, { wrapper });
    // Entry landing → discover (the "Add nearby" flow).
    fireEvent.click(screen.getByRole("button", { name: /build my day/i }));
    // Empty queue → the back action reads "Done".
    expect(screen.getByRole("button", { name: /^done$/i })).toBeInTheDocument();

    // The add lands: query invalidation → useActivePath refetch surfaces the stop.
    todayState.current = {
      ...todayState.current,
      stops: [
        { merchantId: "a", name: "Alpha", address: "1 A St", lat: 30.05, lng: -97.05, category: "retail", status: "pending" },
      ] as unknown as typeof todayState.current.stops,
    };
    rerender(<PathPage />);
    // With a stop queued, the back action now reads "Next"; the rep taps it.
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

    // The rep must land back on the active path (which reflects the added stop),
    // NOT on the entry/proposal landing. Before the fix this asserts false because
    // pathView was stranded at "entry".
    expect(screen.getByTestId("active-path")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /build my day/i })).not.toBeInTheDocument();
  });
});

describe("PathPage discover — Show/Hide map + Next label (Path QA R4)", () => {
  const readyOrigin: PathOrigin = {
    ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready",
  };
  // A geocoded merchant so the map pane renders (anyGeocoded true).
  const liveMerchants = [
    { id: "a", name: "Alpha", address: "1 A St", phone: null, lat: 30.05, lng: -97.05, category: "retail", primaryType: null },
  ] as unknown as typeof merchantsState.current.merchants;

  beforeEach(() => {
    originState.current = readyOrigin;
    merchantsState.current = { merchants: liveMerchants, isLoading: false, isError: false, refetch: vi.fn() } as typeof merchantsState.current;
    todayState.current = {
      ...todayState.current,
      stops: [
        { merchantId: "a", name: "Alpha", address: "1 A St", lat: 30.05, lng: -97.05, category: "retail", status: "pending" },
      ] as unknown as typeof todayState.current.stops,
    };
  });

  it("defaults the discover map hidden on mobile (hidden md:block) with a Show map toggle", () => {
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /add stops/i }));
    // The map pane wraps the mocked MerchantMap; desktop always shows it (md:block)
    // while mobile starts hidden.
    const pane = screen.getByTestId("map").parentElement as HTMLElement;
    expect(pane).toHaveClass("hidden");
    expect(pane).toHaveClass("md:block");
    expect(pane).not.toHaveClass("block");
    expect(screen.getByRole("button", { name: /^show map$/i })).toBeInTheDocument();
  });

  it("toggling Show map flips the mobile visibility class and label", () => {
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /add stops/i }));
    fireEvent.click(screen.getByRole("button", { name: /^show map$/i }));
    const pane = screen.getByTestId("map").parentElement as HTMLElement;
    expect(pane).toHaveClass("block");
    expect(pane).toHaveClass("md:block");
    expect(pane).not.toHaveClass("hidden");
    expect(screen.getByRole("button", { name: /^hide map$/i })).toBeInTheDocument();
  });

  it("labels the secondary discover action 'Next' when there are queued stops", () => {
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /add stops/i }));
    // Primary launch stays "Start path"; the secondary back action is now "Next".
    expect(screen.getByRole("button", { name: /^start path$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^next$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /back to path/i })).not.toBeInTheDocument();
  });
});

describe("PathPage 'Your day' landing header (v2.2 A6)", () => {
  const readyOrigin: PathOrigin = {
    ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready",
  };
  // Minimal routable stops so the entry landing renders (pathView "entry") and
  // proposal.length drives the subhead count.
  const nearbyStop = (i: number) => ({
    id: `n${i}`, kind: "flexible", tier: "nearby", name: `Near ${i}`,
    dealId: null, lat: 30 + i * 0.01, lng: -97, startAt: null, endAt: null, ageDays: null,
  });

  beforeEach(() => {
    originState.current = readyOrigin;
    todayState.current = { ...todayState.current, stops: [], startedAt: null };
  });

  it("titles the entry landing 'Your day' and renders the planned subhead state", () => {
    todaysPathState.current = {
      ...todaysPathState.current,
      proposal: Array.from({ length: 8 }, (_, i) => nearbyStop(i)) as unknown[],
      startsAt: "9:15",
    };
    render(<PathPage />, { wrapper });
    expect(screen.getByRole("heading", { name: /^your day$/i })).toBeInTheDocument();
    expect(screen.getByText("8 stops. Starts at 9:15.")).toBeInTheDocument();
    // The old "Path" title is gone from the landing.
    expect(screen.queryByRole("heading", { name: /^path$/i })).not.toBeInTheDocument();
  });

  it("uses the singular 'stop' for a one-stop day", () => {
    todaysPathState.current = {
      ...todaysPathState.current,
      proposal: [nearbyStop(0)] as unknown[],
      startsAt: "9:15",
    };
    render(<PathPage />, { wrapper });
    expect(screen.getByText("1 stop. Starts at 9:15.")).toBeInTheDocument();
  });

  it("shows the nothing-planned subhead when the day is empty", () => {
    todaysPathState.current = { ...todaysPathState.current, proposal: [], startsAt: null };
    render(<PathPage />, { wrapper });
    expect(screen.getByRole("heading", { name: /^your day$/i })).toBeInTheDocument();
    expect(screen.getByText("No stops yet. Build one to get going.")).toBeInTheDocument();
  });

  it("keeps the discover header as '{N} merchants nearby' with the nearby-vocabulary explainer (not 'Your day')", () => {
    // A geocoded live merchant so the discover branch renders, plus an active path
    // whose "Add stops" enters discover.
    merchantsState.current = {
      merchants: [
        { id: "x", name: "Xray", address: "9 X St", phone: null, lat: 30.04, lng: -97.04, category: "retail", primaryType: null },
      ] as unknown as typeof merchantsState.current.merchants,
      isLoading: false, isError: false, refetch: vi.fn(),
    } as typeof merchantsState.current;
    todayState.current = {
      ...todayState.current,
      stops: [
        { merchantId: "a", name: "Alpha", address: "1 A St", lat: 30.05, lng: -97.05, category: "retail", status: "pending" },
      ] as unknown as typeof todayState.current.stops,
    };
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /add stops/i }));
    // Discover keeps the merchant count wording, NOT "Your day".
    expect(screen.getByText(/merchants? nearby/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^your day$/i })).not.toBeInTheDocument();
    // The one quiet muted explainer line for the count difference.
    expect(screen.getByText(/businesses near you, not stops on your day/i)).toBeInTheDocument();
  });
});
