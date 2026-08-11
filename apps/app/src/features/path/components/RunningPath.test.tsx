import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { RunningPath } from "./RunningPath";
import type { TodayStop } from "../hooks/useTodayPath";
import type { DrivingCard } from "../lib/drivingSequence";
import { directionsUrl } from "../lib/directionsUrl";

// ─── Mocks ────────────────────────────────────────────────────────────────

const clear = vi.fn(async () => {});
let stops: TodayStop[] = [];
let pathId: string | null = "today-1";
let pendingCount = () => stops.filter((s) => s.status === "pending").length;
vi.mock("../hooks/useTodayPath", () => ({
  useTodayPath: () => ({ stops, clear, pathId, pendingCount }),
}));

const carryMutate = vi.fn();
const finalizeMutate = vi.fn();
vi.mock("../hooks/usePathMutations", () => ({
  usePathMutations: () => ({
    carryToTomorrow: { mutateAsync: carryMutate, isPending: false },
    finalizeCurrentPath: { mutateAsync: finalizeMutate, isPending: false },
  }),
}));

// The single-card carousel reads the whole day from useDrivingSequence — mock
// it with a mutable `.current` so each test supplies its own cards array (and a
// rerender can simulate a logged card leaving the sequence on refetch). We also
// record the `now` basis each call receives so the Resume test can assert it is
// re-derived (arrival estimates recompute from the current time on resume).
const seqState = { current: { cards: [] as DrivingCard[], isLoading: false } };
const seqNowCalls: Array<string | number> = [];
vi.mock("../hooks/useDrivingSequence", () => ({
  useDrivingSequence: (_pathDate: string, _origin: unknown, now: string | number) => {
    seqNowCalls.push(now);
    return seqState.current;
  },
}));

// Real per-stop dwell logging (v2.2 B 4.3.2): invisible, best-effort. Mock the
// hook so we can assert what the close-out captures without touching supabase.
type DwellArg = { stopType: string; dealId: string | null; arrivedAt: string; closedAt: string };
const logStopDwell = vi.fn((_input: DwellArg) => Promise.resolve());
vi.mock("../hooks/useLogStopDwell", () => ({
  useLogStopDwell: () => ({ logStopDwell }),
}));

// Live rep position (watch mode) — fixed coords so the run map has an origin
// and the hook never touches real geolocation in jsdom.
vi.mock("../hooks/useGeolocation", () => ({
  useGeolocation: () => ({ coords: { lat: 35, lng: -97 }, status: "ready", error: null, retry: vi.fn() }),
}));

// DayStopsMap is MapLibre — stub it so the Map view renders in jsdom. Exposes
// how many remaining stops it was handed.
vi.mock("./DayStopsMap", () => ({
  DayStopsMap: (props: { stops?: unknown[] }) => (
    <div data-testid="day-stops-map" data-stops={props.stops?.length ?? 0} />
  ),
}));

// RunningPath invalidates the owed / due-today path keys after an owed log. No
// QueryClientProvider in these tests, so stub useQueryClient.
const invalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, useQueryClient: () => ({ invalidateQueries }) };
});

// The three reused outcome sheets, mocked as sibling-visible surfaces. Each
// exposes a button that simulates a SUCCESSFUL log so we can assert the card is
// resolved out of the carousel.
vi.mock("@/features/appointments/components/AppointmentOutcomeSheet", () => ({
  AppointmentOutcomeSheet: (p: { open: boolean; appointmentId: string; dealId: string; onRecorded?: () => void; onOpenChange: (o: boolean) => void }) =>
    p.open ? (
      <div data-testid="appt-sheet" data-appt={p.appointmentId} data-deal={p.dealId}>
        <button onClick={() => { p.onRecorded?.(); p.onOpenChange(false); }}>record-appt</button>
      </div>
    ) : null,
}));
vi.mock("@/features/activities/components/LogActivitySheet", () => ({
  LogActivitySheet: (p: { open: boolean; dealId: string; defaultType?: string; onLogged?: (id: string) => void; onOpenChange: (o: boolean) => void }) =>
    p.open ? (
      <div data-testid="log-activity-sheet" data-deal={p.dealId} data-type={p.defaultType}>
        <button onClick={() => { p.onLogged?.("act-1"); p.onOpenChange(false); }}>save-activity</button>
      </div>
    ) : null,
}));
vi.mock("./DropInSheet", () => ({
  DropInSheet: ({ open, merchant, onLogged, onOpenChange }: any) =>
    open ? (
      <div data-testid="dropin">
        <span>sheet:{merchant?.name}</span>
        <button onClick={() => { onLogged?.("met_dm"); onOpenChange(false); }}>save-log</button>
      </div>
    ) : null,
}));

vi.mock("./EndRouteSheet", () => ({
  EndRouteSheet: (p: { open: boolean; pendingCount: number; onCarry: () => void; onClear: () => void; onComplete: () => void; onOpenChange: (o: boolean) => void }) =>
    p.open ? (
      <div data-testid="end-sheet"><span>{p.pendingCount} pending</span>
        <button onClick={p.onComplete}>mark-complete</button>
        <button onClick={p.onCarry}>carry</button><button onClick={p.onClear}>clear</button>
        <button onClick={() => p.onOpenChange(false)}>cancel</button></div>
    ) : null,
}));
vi.mock("./PathSummary", () => ({
  PathSummary: (p: { skippedCount: number; onNewPath: () => void }) => (
    <div data-testid="summary" data-skipped={p.skippedCount}>
      <button onClick={p.onNewPath}>new-path</button>
    </div>
  ),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

// ─── Fixtures ───────────────────────────────────────────────────────────────

function drivingCard(over: Partial<DrivingCard> = {}): DrivingCard {
  return {
    id: "c1",
    kind: "nearby",
    name: "Alpha",
    address: "1 A St",
    label: "on the way",
    reason: "Nobody's been in yet.",
    lastVisit: null,
    arriveLabel: "around 3:00 PM",
    driveMinLabel: "12 min",
    dealId: null,
    appointmentId: null,
    merchantId: "m1",
    lat: 30,
    lng: -97,
    ...over,
  };
}

function stop(id: string, over: Partial<TodayStop> = {}): TodayStop {
  return {
    merchantId: id, name: id, address: "1 Main", lat: 35, lng: -97, category: "manufacturing_wholesale",
    primaryType: null, phone: "+15551230000", status: "pending", disposition: null, notes: null, dealCreated: false, addedAt: "t", ...over,
  };
}
const ORIGIN = { lat: 35, lng: -97 };

beforeEach(() => {
  clear.mockClear();
  carryMutate.mockReset();
  finalizeMutate.mockReset();
  invalidateQueries.mockClear();
  logStopDwell.mockClear();
  logStopDwell.mockImplementation(() => Promise.resolve());
  stops = [];
  pathId = "today-1";
  pendingCount = () => stops.filter((s) => s.status === "pending").length;
  seqState.current = { cards: [], isLoading: false };
  seqNowCalls.length = 0;
});

describe("RunningPath — driving carousel", () => {
  it("renders ONE card: counter, name, address, both tiles, reason, and lastVisit", () => {
    seqState.current = {
      cards: [
        drivingCard({ name: "Alpha", address: "1 A St", reason: "You owe them a visit.", lastVisit: "Last time, met the decision maker.", arriveLabel: "around 3:00 PM", driveMinLabel: "12 min" }),
        drivingCard({ id: "c2", name: "Bravo", merchantId: "m2" }),
      ],
      isLoading: false,
    };
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);

    expect(screen.getByText(/stop 1 of 2/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByText("1 A St")).toBeInTheDocument();
    expect(screen.getByText("around 3:00 PM")).toBeInTheDocument();
    expect(screen.getByText("12 min")).toBeInTheDocument();
    expect(screen.getByText("You owe them a visit.")).toBeInTheDocument();
    expect(screen.getByText("Last time, met the decision maker.")).toBeInTheDocument();
    // Only ONE card at a time: Bravo is not rendered.
    expect(screen.queryByRole("heading", { name: "Bravo" })).not.toBeInTheDocument();
  });

  it("renders exactly three actions plus the Who's-near-me link, which calls onFindNearby", () => {
    seqState.current = { cards: [drivingCard()], isLoading: false };
    const onFindNearby = vi.fn();
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={onFindNearby} />);

    expect(screen.getByRole("button", { name: /i'm here/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /navigate/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /skip for now/i })).toBeInTheDocument();

    const link = screen.getByRole("button", { name: /who's near me right now/i });
    fireEvent.click(link);
    expect(onFindNearby).toHaveBeenCalledTimes(1);
  });

  it("Navigate is an anchor to directionsUrl(lat,lng); hidden when coords are null", () => {
    seqState.current = { cards: [drivingCard({ lat: 30, lng: -97 })], isLoading: false };
    const { rerender } = render(
      <RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />,
    );
    expect(screen.getByRole("link", { name: /navigate/i })).toHaveAttribute("href", directionsUrl(30, -97));

    seqState.current = { cards: [drivingCard({ lat: null, lng: null })], isLoading: false };
    rerender(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /navigate/i })).not.toBeInTheDocument();
  });

  it("I'm here opens the AppointmentOutcomeSheet for an appointment card", () => {
    seqState.current = { cards: [drivingCard({ kind: "appointment", appointmentId: "a1", dealId: "d1", merchantId: null })], isLoading: false };
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /i'm here/i }));
    const sheet = screen.getByTestId("appt-sheet");
    expect(sheet).toHaveAttribute("data-appt", "a1");
    expect(sheet).toHaveAttribute("data-deal", "d1");
  });

  it("I'm here opens the LogActivitySheet (drop_in) for an owed card", () => {
    seqState.current = { cards: [drivingCard({ kind: "owed", dealId: "deal-owed-1", merchantId: null })], isLoading: false };
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /i'm here/i }));
    const sheet = screen.getByTestId("log-activity-sheet");
    expect(sheet).toHaveAttribute("data-deal", "deal-owed-1");
    expect(sheet).toHaveAttribute("data-type", "drop_in");
  });

  it("I'm here opens the DropInSheet for a nearby card", () => {
    seqState.current = { cards: [drivingCard({ kind: "nearby", name: "Alpha", merchantId: "m1" })], isLoading: false };
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /i'm here/i }));
    expect(screen.getByTestId("dropin")).toBeInTheDocument();
    expect(screen.getByText("sheet:Alpha")).toBeInTheDocument();
  });

  it("an external card's action reads Mark done and advances with no outcome grid", () => {
    seqState.current = {
      cards: [
        drivingCard({ kind: "external", name: "Team sync", appointmentId: null, dealId: null, merchantId: null }),
        drivingCard({ id: "c2", name: "Bravo", merchantId: "m2" }),
      ],
      isLoading: false,
    };
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^i'm here$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /mark done/i }));
    // The external card resolves out; the next card takes its place, no sheet.
    // The denominator stays the full day roster (2) — the resolved card stays IN
    // the total; only the position advances (A10/3.4).
    expect(screen.getByRole("heading", { name: "Bravo" })).toBeInTheDocument();
    expect(screen.getByText(/stop 2 of 2/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Team sync" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("dropin")).not.toBeInTheDocument();
    expect(screen.queryByTestId("appt-sheet")).not.toBeInTheDocument();
    expect(screen.queryByTestId("log-activity-sheet")).not.toBeInTheDocument();
  });

  it("Skip for now resolves the current card so the next one shows", () => {
    seqState.current = {
      cards: [drivingCard({ name: "Alpha", merchantId: "m1" }), drivingCard({ id: "c2", name: "Bravo", merchantId: "m2" })],
      isLoading: false,
    };
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    expect(screen.getByText(/stop 1 of 2/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /skip for now/i }));
    expect(screen.getByRole("heading", { name: "Bravo" })).toBeInTheDocument();
    expect(screen.getByText(/stop 2 of 2/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Alpha" })).not.toBeInTheDocument();
  });

  it("logging the current NEARBY card resolves it out of the carousel (no refetch needed)", () => {
    seqState.current = {
      cards: [drivingCard({ name: "Alpha", merchantId: "m1" }), drivingCard({ id: "c2", name: "Bravo", merchantId: "m2" })],
      isLoading: false,
    };
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /i'm here/i }));
    fireEvent.click(screen.getByText("save-log"));
    // Alpha is gone locally (via the resolved set); Bravo is now the current stop.
    // The denominator holds at the full roster (2); position advances to 2.
    expect(screen.getByRole("heading", { name: "Bravo" })).toBeInTheDocument();
    expect(screen.getByText(/stop 2 of 2/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Alpha" })).not.toBeInTheDocument();
  });

  it("logging the current OWED card resolves it out of the carousel", () => {
    seqState.current = {
      cards: [
        drivingCard({ id: "owed-1", kind: "owed", name: "Owed Co", dealId: "deal-owed-1", merchantId: null }),
        drivingCard({ id: "c2", name: "Bravo", merchantId: "m2" }),
      ],
      isLoading: false,
    };
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Owed Co" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /i'm here/i }));
    fireEvent.click(screen.getByText("save-activity"));
    expect(screen.getByRole("heading", { name: "Bravo" })).toBeInTheDocument();
    expect(screen.getByText(/stop 2 of 2/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Owed Co" })).not.toBeInTheDocument();
    // Belt and suspenders: the owed / due-today reads are invalidated so other
    // surfaces (Stops tab) drop the resolved stop too.
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["path", "owed-visits"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["path", "due-today-visits"] });
  });

  it("recording an APPOINTMENT outcome resolves it out of the carousel", () => {
    seqState.current = {
      cards: [
        drivingCard({ id: "appt-1", kind: "appointment", name: "Renewal review", appointmentId: "a1", dealId: "d1", merchantId: null }),
        drivingCard({ id: "c2", name: "Bravo", merchantId: "m2" }),
      ],
      isLoading: false,
    };
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Renewal review" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /i'm here/i }));
    fireEvent.click(screen.getByText("record-appt"));
    expect(screen.getByRole("heading", { name: "Bravo" })).toBeInTheDocument();
    expect(screen.getByText(/stop 2 of 2/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Renewal review" })).not.toBeInTheDocument();
  });

  it("shows a loading state while the sources load", () => {
    seqState.current = { cards: [], isLoading: true };
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    expect(screen.getByText(/loading your day/i)).toBeInTheDocument();
  });

  it("shows the done state (with a start-again affordance) when no cards remain", () => {
    seqState.current = { cards: [], isLoading: false };
    stops = [stop("A", { status: "visited" }), stop("B", { status: "skipped" })];
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    expect(screen.getByTestId("summary")).toBeInTheDocument();
    expect(screen.getByText("new-path")).toBeInTheDocument();
  });
});

// ─── One authoritative day count (A10 / 3.4) ─────────────────────────────────

describe("RunningPath — one authoritative day count", () => {
  // A day of 2 appointments + 1 owed + 1 nearby: the run's status row and the
  // stop card must state the SAME total (4) = the full driving-sequence roster,
  // and that total must NOT move as stops resolve — only progress advances.
  const fourStopDay: DrivingCard[] = [
    drivingCard({ id: "appt-1", kind: "appointment", name: "Renewal review", appointmentId: "a1", dealId: "d1", merchantId: null }),
    drivingCard({ id: "appt-2", kind: "appointment", name: "Kickoff", appointmentId: "a2", dealId: "d2", merchantId: null }),
    drivingCard({ id: "owed-1", kind: "owed", name: "Owed Co", dealId: "deal-owed-1", merchantId: null }),
    drivingCard({ id: "near-1", kind: "nearby", name: "Corner Cafe", merchantId: "m1" }),
  ];

  it("status row and card state the SAME total (the full roster), not the native-only count", () => {
    seqState.current = { cards: fourStopDay, isLoading: false };
    // Persisted path_stops holds ONLY the nearby tier (1) — the OLD status-row
    // source. The authoritative total must be 4, not this under-count.
    stops = [stop("m1")];
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    // Status row: 0 of 4 (progress / authoritative total), NOT 0/1.
    expect(screen.getByText(/0\/4 stops/i)).toBeInTheDocument();
    expect(screen.queryByText(/0\/1 stops/i)).not.toBeInTheDocument();
    // Card: Stop 1 of 4 — same denominator as the status row.
    expect(screen.getByText(/stop 1 of 4/i)).toBeInTheDocument();
  });

  it("the denominator stays fixed at the full roster after a resolve; progress advances", () => {
    seqState.current = { cards: fourStopDay, isLoading: false };
    stops = [stop("m1")];
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    expect(screen.getByText(/0\/4 stops/i)).toBeInTheDocument();
    expect(screen.getByText(/stop 1 of 4/i)).toBeInTheDocument();

    // Skip the first appointment. It STAYS in the total (still "of 4"); the
    // status row now reads 1 of 4 and the card advances to Stop 2 of 4.
    fireEvent.click(screen.getByRole("button", { name: /skip for now/i }));
    expect(screen.getByText(/1\/4 stops/i)).toBeInTheDocument();
    expect(screen.getByText(/stop 2 of 4/i)).toBeInTheDocument();
    // The denominator did not shrink to 3.
    expect(screen.queryByText(/stop 1 of 3/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/of 3\b/i)).not.toBeInTheDocument();
  });

  it("holds the denominator fixed even when a background refetch drops the resolved card", () => {
    seqState.current = { cards: fourStopDay, isLoading: false };
    stops = [stop("m1")];
    const { rerender } = render(
      <RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />,
    );
    // Resolve the first appointment locally.
    fireEvent.click(screen.getByRole("button", { name: /skip for now/i }));
    expect(screen.getByText(/stop 2 of 4/i)).toBeInTheDocument();

    // Simulate a refetch that drops the just-resolved card from the live
    // sequence. The denominator must STILL be 4 (the resolved stop stays in the
    // total), and progress stays at 1 of 4.
    seqState.current = { cards: fourStopDay.slice(1), isLoading: false };
    rerender(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    expect(screen.getByText(/1\/4 stops/i)).toBeInTheDocument();
    expect(screen.getByText(/stop 2 of 4/i)).toBeInTheDocument();
  });
});

// ─── "What remains" expandable (A7/3.3) ──────────────────────────────────────

describe("RunningPath — what-remains expandable (card-first, no tabs)", () => {
  it("collapses by default and expands into a List | Map of the upcoming stops", () => {
    seqState.current = {
      cards: [
        drivingCard({ id: "c1", name: "Alpha", merchantId: "m1" }),
        drivingCard({ id: "c2", name: "Bravo", merchantId: "m2" }),
        drivingCard({ id: "c3", name: "Charlie", merchantId: "m3" }),
      ],
      isLoading: false,
    };
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    // The current stop is the card; the remaining count is the two AFTER it.
    const remainingRow = screen.getByRole("button", { name: /2 stops remaining/i });
    expect(remainingRow).toHaveAttribute("aria-expanded", "false");
    // Collapsed: no List | Map toggle, no map.
    expect(screen.queryByRole("tab", { name: /^list$/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("day-stops-map")).not.toBeInTheDocument();

    // Expand -> List (default) shows the upcoming stop names; Map is hidden-but-mounted.
    fireEvent.click(remainingRow);
    expect(remainingRow).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("tab", { name: /^list$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^map$/i })).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    // Map view carries exactly the two upcoming stops + live rep position.
    fireEvent.click(screen.getByRole("tab", { name: /^map$/i }));
    expect(screen.getByTestId("day-stops-map")).toHaveAttribute("data-stops", "2");
  });

  it("auto-collapses the expanded section on a resolve (skip), returning the rep to the card", () => {
    seqState.current = {
      cards: [
        drivingCard({ id: "c1", name: "Alpha", merchantId: "m1" }),
        drivingCard({ id: "c2", name: "Bravo", merchantId: "m2" }),
        drivingCard({ id: "c3", name: "Charlie", merchantId: "m3" }),
      ],
      isLoading: false,
    };
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /2 stops remaining/i }));
    fireEvent.click(screen.getByRole("tab", { name: /^map$/i }));
    expect(screen.getByTestId("day-stops-map")).toBeInTheDocument();

    // Skip resolves Alpha; Bravo becomes the card. Still 1 upcoming stop (Charlie),
    // but the section must have COLLAPSED back to the card (no toggle, no map).
    fireEvent.click(screen.getByRole("button", { name: /skip for now/i }));
    expect(screen.getByRole("heading", { name: "Bravo" })).toBeInTheDocument();
    const collapsedRow = screen.getByRole("button", { name: /1 stop remaining/i });
    expect(collapsedRow).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("day-stops-map")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^map$/i })).not.toBeInTheDocument();
  });

  it("shows no remaining row on the last stop (nothing after the card)", () => {
    seqState.current = { cards: [drivingCard({ id: "c1", name: "Alpha", merchantId: "m1" })], isLoading: false };
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /remaining/i })).not.toBeInTheDocument();
  });
});

// ─── End-route / Pause flow ──────────────────────────────────────────────────

describe("RunningPath — End route / Pause flow", () => {
  beforeEach(() => {
    seqState.current = { cards: [drivingCard()], isLoading: false };
  });

  it("Pause is reversible: it swaps to Resume in place (no confirmation), then back", () => {
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    // Not paused: Pause shown, status reads active.
    expect(screen.getByText(/path active/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    // Paused: status flips, Resume replaces Pause in the same row (no confirm dialog).
    expect(screen.getByText(/path paused/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^resume$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^pause$/i })).not.toBeInTheDocument();
    // The stop card stays visible while paused (the day is not discarded).
    expect(screen.getByRole("heading", { name: "Alpha" })).toBeInTheDocument();
    // Resume returns to Pause.
    fireEvent.click(screen.getByRole("button", { name: /^resume$/i }));
    expect(screen.getByText(/path active/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^pause$/i })).toBeInTheDocument();
  });

  it("Resume re-derives the run's 'now' so arrival estimates recompute from the current time", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-11T15:00:00.000Z"));
      render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
      // Mount captured 15:00 as the arrival basis.
      expect(seqNowCalls[seqNowCalls.length - 1]).toBe("2026-08-11T15:00:00.000Z");
      // An hour is lost while paused.
      fireEvent.click(screen.getByRole("button", { name: /^pause$/i }));
      vi.setSystemTime(new Date("2026-08-11T16:00:00.000Z"));
      fireEvent.click(screen.getByRole("button", { name: /^resume$/i }));
      // The latest useDrivingSequence call uses the NEW now (16:00), not the stale mount time.
      expect(seqNowCalls[seqNowCalls.length - 1]).toBe("2026-08-11T16:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("End route with pending stops opens the sheet", () => {
    stops = [stop("A"), stop("B")];
    pendingCount = () => 2;
    const onExitSpy = vi.fn();
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={onExitSpy} onFindNearby={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    expect(screen.getByTestId("end-sheet")).toBeInTheDocument();
    expect(onExitSpy).not.toHaveBeenCalled();
  });

  it("End route with no pending stops exits immediately", () => {
    stops = [stop("A", { status: "visited" })];
    pendingCount = () => 0;
    const onExitSpy = vi.fn();
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={onExitSpy} onFindNearby={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    expect(onExitSpy).toHaveBeenCalled();
    expect(screen.queryByTestId("end-sheet")).not.toBeInTheDocument();
  });

  it("Carry to tomorrow calls carryToTomorrow then exits", async () => {
    stops = [stop("A"), stop("B")];
    pendingCount = () => 2;
    carryMutate.mockResolvedValueOnce(undefined);
    const onExitSpy = vi.fn();
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={onExitSpy} onFindNearby={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    await act(async () => { fireEvent.click(screen.getByText("carry")); });
    expect(carryMutate).toHaveBeenCalledWith({ pathId: "today-1", pathDate: expect.any(String) });
    expect(onExitSpy).toHaveBeenCalled();
    expect(screen.queryByTestId("end-sheet")).not.toBeInTheDocument();
  });

  it("Carry failure keeps the sheet open and does not exit", async () => {
    stops = [stop("A"), stop("B")];
    pendingCount = () => 2;
    carryMutate.mockRejectedValueOnce(new Error("network"));
    const onExitSpy = vi.fn();
    const { toast } = await import("sonner");
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={onExitSpy} onFindNearby={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    await act(async () => { fireEvent.click(screen.getByText("carry")); });
    expect(toast.error).toHaveBeenCalled();
    expect(onExitSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("end-sheet")).toBeInTheDocument();
  });

  it("Clear & start over (confirmed) clears and exits", async () => {
    stops = [stop("A"), stop("B")];
    pendingCount = () => 2;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onExitSpy = vi.fn();
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={onExitSpy} onFindNearby={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    await act(async () => { fireEvent.click(screen.getByText("clear")); });
    expect(clear).toHaveBeenCalled();
    expect(onExitSpy).toHaveBeenCalled();
  });

  it("Mark route complete finalizes and shows the report without exiting", async () => {
    stops = [stop("A"), stop("B", { status: "visited" })];
    pendingCount = () => 1;
    finalizeMutate.mockResolvedValueOnce(undefined);
    const onExitSpy = vi.fn();
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={onExitSpy} onFindNearby={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    await act(async () => { fireEvent.click(screen.getByText("mark-complete")); });
    expect(finalizeMutate).toHaveBeenCalledWith("today-1");
    const summary = screen.getByTestId("summary");
    expect(summary).toBeInTheDocument();
    // pending-as-skipped: already-skipped (0) + pending (1 = stop A) = 1
    expect(summary).toHaveAttribute("data-skipped", "1");
    expect(onExitSpy).not.toHaveBeenCalled();
  });

  it("Mark complete failure toasts and keeps the sheet open (no report)", async () => {
    stops = [stop("A")];
    pendingCount = () => 1;
    finalizeMutate.mockRejectedValueOnce(new Error("boom"));
    const onExitSpy = vi.fn();
    const { toast } = await import("sonner");
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={onExitSpy} onFindNearby={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    await act(async () => { fireEvent.click(screen.getByText("mark-complete")); });
    expect(toast.error).toHaveBeenCalled();
    expect(screen.queryByTestId("summary")).not.toBeInTheDocument();
    expect(onExitSpy).not.toHaveBeenCalled();
  });

  it("Cancel closes the sheet without mutating or exiting", () => {
    stops = [stop("A"), stop("B")];
    pendingCount = () => 2;
    const onExitSpy = vi.fn();
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={onExitSpy} onFindNearby={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    fireEvent.click(screen.getByText("cancel"));
    expect(screen.queryByTestId("end-sheet")).not.toBeInTheDocument();
    expect(carryMutate).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(onExitSpy).not.toHaveBeenCalled();
  });
});

// ─── Real per-stop dwell logging (v2.2 B 4.3.2) ──────────────────────────────

describe("RunningPath real dwell logging (arrival to close-out)", () => {
  it("logs a dwell with the right stopType, dealId, and a positive interval when an APPOINTMENT is closed out after I'm here", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-11T15:00:00.000Z"));
      seqState.current = {
        cards: [drivingCard({ id: "appt-1", kind: "appointment", name: "Renewal review", appointmentId: "a1", dealId: "d1", merchantId: null })],
        isLoading: false,
      };
      render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
      // Arrival stamped at 15:00.
      fireEvent.click(screen.getByRole("button", { name: /i'm here/i }));
      // 20 minutes later the rep closes the stop out.
      vi.setSystemTime(new Date("2026-08-11T15:20:00.000Z"));
      fireEvent.click(screen.getByText("record-appt"));

      expect(logStopDwell).toHaveBeenCalledTimes(1);
      const arg = logStopDwell.mock.calls[0]![0];
      expect(arg.stopType).toBe("appointment");
      expect(arg.dealId).toBe("d1");
      expect(new Date(arg.closedAt).getTime()).toBeGreaterThan(new Date(arg.arrivedAt).getTime());
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs a NEARBY drop-in close-out as stop_type 'discovery' with a null deal", () => {
    seqState.current = { cards: [drivingCard({ id: "near-1", kind: "nearby", name: "Corner Cafe", merchantId: "m1", dealId: null })], isLoading: false };
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /i'm here/i }));
    fireEvent.click(screen.getByText("save-log"));

    expect(logStopDwell).toHaveBeenCalledTimes(1);
    const arg = logStopDwell.mock.calls[0]![0];
    expect(arg.stopType).toBe("discovery");
    expect(arg.dealId).toBeNull();
  });

  it("does NOT log a dwell when a stop is skipped (no I'm here arrival)", () => {
    seqState.current = {
      cards: [drivingCard({ id: "c1", name: "Alpha", merchantId: "m1" }), drivingCard({ id: "c2", name: "Bravo", merchantId: "m2" })],
      isLoading: false,
    };
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /skip for now/i }));
    expect(logStopDwell).not.toHaveBeenCalled();
  });

  it("the run flow is unaffected when the dwell write rejects (best-effort): the card still resolves out", () => {
    logStopDwell.mockImplementation(() => Promise.reject(new Error("insert failed")));
    seqState.current = {
      cards: [drivingCard({ id: "near-1", kind: "nearby", name: "Corner Cafe", merchantId: "m1" }), drivingCard({ id: "c2", name: "Bravo", merchantId: "m2" })],
      isLoading: false,
    };
    render(<RunningPath origin={ORIGIN} onViewPipeline={vi.fn()} onExit={vi.fn()} onFindNearby={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /i'm here/i }));
    fireEvent.click(screen.getByText("save-log"));
    // The dwell write was attempted, and the run advanced normally despite it failing.
    expect(logStopDwell).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Bravo" })).toBeInTheDocument();
    expect(screen.getByText(/stop 2 of 2/i)).toBeInTheDocument();
  });
});
