import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RunningPath } from "./RunningPath";
import type { TodayStop } from "../hooks/useTodayPath";
import type { MeetingStop } from "../lib/meetingStops";
import type { OwedVisit } from "../lib/owedVisits";

const setStatus = vi.fn(async () => {});
const clear = vi.fn(async () => {});
let stops: TodayStop[] = [];
let pathId: string | null = "today-1";
let pendingCount = () => stops.filter((s) => s.status === "pending").length;
vi.mock("../hooks/useTodayPath", () => ({
  useTodayPath: () => ({ stops, setStatus, clear, pathId, pendingCount }),
}));
const carryMutate = vi.fn();
const finalizeMutate = vi.fn();
vi.mock("../hooks/usePathMutations", () => ({
  usePathMutations: () => ({
    carryToTomorrow: { mutateAsync: carryMutate, isPending: false },
    finalizeCurrentPath: { mutateAsync: finalizeMutate, isPending: false },
  }),
}));

// SP-C3: RunningPath now composes useLiveDayTiers, which reads the day's LIVE
// tiers from these three hooks. Mock them (default: none) so the existing
// guided-run tests see only native stops, and individual SP-C3 tests override.
const meetingState = { current: { stops: [] as MeetingStop[] } };
const owedState = { current: { owed: [] as OwedVisit[] } };
const dueTodayState = { current: { dueToday: [] as OwedVisit[] } };
vi.mock("../hooks/useMeetingStops", () => ({ useMeetingStops: () => meetingState.current }));
vi.mock("../hooks/useOwedVisits", () => ({ useOwedVisits: () => owedState.current }));
vi.mock("../hooks/useDueTodayVisits", () => ({ useDueTodayVisits: () => dueTodayState.current }));

// useLiveDayTiers routes "Open deal" through react-router's useNavigate; spy it.
const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

// The reused live-tier sheets, mocked as sibling-visible surfaces so we can
// assert an owed stop's "Log drop-in" reaches the existing flow keyed by the
// deal id WITHOUT exercising the real sheet.
const outcomeSheet = vi.fn();
vi.mock("@/features/appointments/components/AppointmentOutcomeSheet", () => ({
  AppointmentOutcomeSheet: (props: { appointmentId: string; dealId: string }) => {
    outcomeSheet(props);
    return <div data-testid="outcome-sheet" data-appt={props.appointmentId} data-deal={props.dealId} />;
  },
}));
const logActivitySheet = vi.fn();
vi.mock("@/features/activities/components/LogActivitySheet", () => ({
  LogActivitySheet: (props: { dealId: string; defaultType?: string }) => {
    logActivitySheet(props);
    return <div data-testid="log-activity-sheet" data-deal={props.dealId} data-type={props.defaultType} />;
  },
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
vi.mock("./DropInSheet", () => ({
  DropInSheet: ({ open, merchant, onLogged, onOpenChange }: any) =>
    open ? (
      <div data-testid="dropin">
        <span>sheet:{merchant?.name}</span>
        <button onClick={() => { onLogged?.("met_dm"); onOpenChange(false); }}>save-log</button>
      </div>
    ) : null,
}));
vi.mock("./PathSummary", () => ({ PathSummary: (p: { skippedCount: number }) => <div data-testid="summary" data-skipped={p.skippedCount}>summary</div> }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

function stop(id: string, over: Partial<TodayStop> = {}): TodayStop {
  return { merchantId: id, name: id, address: "1 Main", lat: 35, lng: -97, category: "manufacturing_wholesale",
    primaryType: null, phone: "+15551230000", status: "pending", disposition: null, notes: null, dealCreated: false, addedAt: "t", ...over };
}
const ORIGIN = { lat: 35, lng: -97 };

/** A routable owed visit fixture (SP-C3). `earliestAt` strictly before today
 *  makes it PAST-DUE; equal-to-today would be due-today. */
function owedVisit(over: Partial<OwedVisit> = {}): OwedVisit {
  return {
    taskId: "t1",
    dealId: "deal-owed-1",
    name: "Owed Co",
    address: "500 Owed St",
    placeId: "place-1",
    lat: 30.2,
    lng: -97.6,
    urgency: 1,
    bandPosition: "aging",
    dateSource: "interval",
    targetAt: "2000-01-05",
    earliestAt: "2000-01-01",
    latestAt: "2000-01-10",
    snoozeCount: 0,
    sourceOutcome: "appt_no_show",
    createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    ...over,
  };
}

// Render inside a QueryClientProvider (useLiveDayTiers calls useQueryClient). The
// `wrapper` option makes rerender re-apply the provider automatically.
function renderRun(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

beforeEach(() => {
  setStatus.mockClear();
  clear.mockClear();
  carryMutate.mockReset();
  finalizeMutate.mockReset();
  navigate.mockClear();
  outcomeSheet.mockClear();
  logActivitySheet.mockClear();
  pathId = "today-1";
  pendingCount = () => stops.filter((s) => s.status === "pending").length;
  meetingState.current = { stops: [] };
  owedState.current = { owed: [] };
  dueTodayState.current = { dueToday: [] };
});

describe("RunningPath", () => {
  it("starts at the first pending stop", () => {
    stops = [stop("A", { status: "visited" }), stop("B"), stop("C")];
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "B" })).toBeInTheDocument();
    expect(screen.getByText(/stop 2 of 3/i)).toBeInTheDocument();
  });
  it("hides Call when the stop has no phone, shows Directions always", () => {
    stops = [stop("A", { phone: null })];
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /call/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /directions/i })).toHaveAttribute("href", expect.stringContaining("maps/dir"));
  });
  it("Skip marks the stop skipped and advances", () => {
    stops = [stop("A"), stop("B")];
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));
    expect(setStatus).toHaveBeenCalledWith("A", "skipped");
    expect(screen.getByRole("heading", { name: "B" })).toBeInTheDocument();
  });
  it("logging a drop-in advances to the next pending stop", () => {
    stops = [stop("A"), stop("B")];
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /log drop-in/i }));
    fireEvent.click(screen.getByText("save-log"));
    expect(screen.getByRole("heading", { name: "B" })).toBeInTheDocument();
  });
  it("Prev is disabled on the first shown stop", () => {
    stops = [stop("A"), stop("B")];
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByRole("button", { name: /prev/i })).toBeDisabled();
  });
  it("shows the summary when no stops are pending", () => {
    stops = [stop("A", { status: "visited" }), stop("B", { status: "skipped" })];
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByTestId("summary")).toBeInTheDocument();
  });
  it("Pause calls onPause", () => {
    stops = [stop("A")];
    const onPause = vi.fn();
    renderRun(<RunningPath origin={ORIGIN} onPause={onPause} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /pause/i }));
    expect(onPause).toHaveBeenCalled();
  });
  it("shows summary after logging the last pending stop", () => {
    stops = [stop("A")]; // only one pending
    const { rerender } = renderRun(
      <RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /log drop-in/i }));
    fireEvent.click(screen.getByText("save-log"));
    // Simulate the query refetch flipping the logged stop to visited:
    stops = [stop("A", { status: "visited" })];
    rerender(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByTestId("summary")).toBeInTheDocument();
  });

  it("End route with pending stops opens the sheet", () => {
    stops = [stop("A"), stop("B")];
    pendingCount = () => 2;
    pathId = "today-1";
    const onExitSpy = vi.fn();
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={onExitSpy} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    expect(screen.getByTestId("end-sheet")).toBeInTheDocument();
    expect(onExitSpy).not.toHaveBeenCalled();
  });
  it("Carry to tomorrow calls carryToTomorrow then exits", async () => {
    stops = [stop("A"), stop("B")];
    pendingCount = () => 2;
    pathId = "today-1";
    carryMutate.mockResolvedValueOnce(undefined);
    const onExitSpy = vi.fn();
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={onExitSpy} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    await act(async () => { fireEvent.click(screen.getByText("carry")); });
    expect(carryMutate).toHaveBeenCalledWith({ pathId: "today-1", pathDate: expect.any(String) });
    expect(onExitSpy).toHaveBeenCalled();
    expect(screen.queryByTestId("end-sheet")).not.toBeInTheDocument();
  });
  it("Carry failure keeps the sheet open and does not exit", async () => {
    stops = [stop("A"), stop("B")];
    pendingCount = () => 2;
    pathId = "today-1";
    carryMutate.mockRejectedValueOnce(new Error("network"));
    const onExitSpy = vi.fn();
    const { toast } = await import("sonner");
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={onExitSpy} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    await act(async () => { fireEvent.click(screen.getByText("carry")); });
    expect(toast.error).toHaveBeenCalled();
    expect(onExitSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("end-sheet")).toBeInTheDocument();
  });
  it("Clear & start over (confirmed) clears and exits", async () => {
    stops = [stop("A"), stop("B")];
    pendingCount = () => 2;
    pathId = "today-1";
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onExitSpy = vi.fn();
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={onExitSpy} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    await act(async () => { fireEvent.click(screen.getByText("clear")); });
    expect(clear).toHaveBeenCalled();
    expect(onExitSpy).toHaveBeenCalled();
  });
  it("Clear failure keeps the sheet open and does not exit", async () => {
    stops = [stop("A"), stop("B")];
    pendingCount = () => 2;
    pathId = "today-1";
    vi.spyOn(window, "confirm").mockReturnValue(true);
    clear.mockRejectedValueOnce(new Error("delete failed"));
    const onExitSpy = vi.fn();
    const { toast } = await import("sonner");
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={onExitSpy} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    await act(async () => { fireEvent.click(screen.getByText("clear")); });
    expect(toast.error).toHaveBeenCalled();
    expect(onExitSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("end-sheet")).toBeInTheDocument();
  });
  it("Mark route complete finalizes and shows the report without exiting", async () => {
    stops = [stop("A"), stop("B", { status: "visited" })];
    pendingCount = () => 1;
    pathId = "today-1";
    finalizeMutate.mockResolvedValueOnce(undefined);
    const onExitSpy = vi.fn();
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={onExitSpy} />);
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
    pathId = "today-1";
    finalizeMutate.mockRejectedValueOnce(new Error("boom"));
    const onExitSpy = vi.fn();
    const { toast } = await import("sonner");
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={onExitSpy} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    await act(async () => { fireEvent.click(screen.getByText("mark-complete")); });
    expect(toast.error).toHaveBeenCalled();
    expect(screen.queryByTestId("summary")).not.toBeInTheDocument();
    expect(onExitSpy).not.toHaveBeenCalled();
  });
  it("Cancel closes the sheet without mutating or exiting", () => {
    stops = [stop("A"), stop("B")];
    pendingCount = () => 2;
    pathId = "today-1";
    const onExitSpy = vi.fn();
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={onExitSpy} />);
    fireEvent.click(screen.getByRole("button", { name: /end route/i }));
    fireEvent.click(screen.getByText("cancel"));
    expect(screen.queryByTestId("end-sheet")).not.toBeInTheDocument();
    expect(carryMutate).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(onExitSpy).not.toHaveBeenCalled();
  });

  // ─── runOverlay (S3: meeting-aware overlay) ──────────────────────────
  const OVERLAY = {
    arrive: "2026-07-08T15:00:00.000Z",
    dwellMin: 20,
    currentStopName: "A",
    nextMeeting: { title: "Acme sync", start: "2026-07-08T16:00:00.000Z", located: true },
    stopsUntilNextMeeting: 2,
    fits: true,
  };

  it("renders the next meeting title and stops-to-go when a runOverlay is given", () => {
    stops = [stop("A"), stop("B")];
    renderRun(
      <RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} runOverlay={OVERLAY} />,
    );
    expect(screen.getByText(/Acme sync/)).toBeInTheDocument();
    expect(screen.getByText(/2 stops to go/i)).toBeInTheDocument();
  });

  it("renders a role=alert warning when the current stop won't fit (fits:false)", () => {
    stops = [stop("A")];
    renderRun(
      <RunningPath
        origin={ORIGIN}
        onPause={vi.fn()}
        onViewPipeline={vi.fn()}
        onExit={vi.fn()}
        runOverlay={{ ...OVERLAY, fits: false }}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders no meeting or alert text when runOverlay is null (existing behavior preserved)", () => {
    stops = [stop("A")];
    renderRun(
      <RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} runOverlay={null} />,
    );
    expect(screen.queryByText(/Acme sync/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders no meeting or alert text when runOverlay is omitted (existing behavior preserved)", () => {
    stops = [stop("A")];
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    expect(screen.queryByText(/Acme sync/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("hides the overlay when Prev peeks a non-current (visited) stop", () => {
    // First stop visited, second pending → the run starts on the pending stop (B),
    // which IS the current (first-pending) stop, so the overlay renders. Navigating
    // Prev onto the visited stop A (not the current stop) must hide the overlay so
    // it never names a meeting/ETA under a stop the rep is only peeking at.
    stops = [stop("A", { status: "visited" }), stop("B")];
    renderRun(
      <RunningPath
        origin={ORIGIN}
        onPause={vi.fn()}
        onViewPipeline={vi.fn()}
        onExit={vi.fn()}
        runOverlay={{ ...OVERLAY, fits: false }}
      />,
    );
    // Starts at the first pending stop (B) → overlay + fit warning visible.
    // (With fits:false the title appears in both the banner and the alert.)
    expect(screen.getByRole("heading", { name: "B" })).toBeInTheDocument();
    expect(screen.getAllByText(/Acme sync/).length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Prev peeks the visited, non-current stop A → overlay must not follow.
    fireEvent.click(screen.getByRole("button", { name: /prev/i }));
    expect(screen.getByRole("heading", { name: "A" })).toBeInTheDocument();
    expect(screen.queryByText(/Acme sync/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // ─── SP-C3: the run surfaces ALL tiers, not just the native route ─────
  const region = () =>
    within(screen.getByRole("region", { name: /appointments and follow-ups/i }));

  it("surfaces past-due and due-today tiers alongside the focused native card", () => {
    stops = [stop("A")]; // one native pending stop → focused card renders
    owedState.current = { owed: [owedVisit()] };
    dueTodayState.current = {
      dueToday: [owedVisit({ taskId: "t2", dealId: "deal-due-1", name: "Due Today Co", earliestAt: new Date().toISOString().slice(0, 10) })],
    };
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);

    // The focused native guided-run card still renders (unchanged behavior).
    expect(screen.getByRole("heading", { name: "A" })).toBeInTheDocument();
    expect(screen.getByText(/stop 1 of 1/i)).toBeInTheDocument();

    // The live tiers now appear in the run - the QA complaint fix.
    const live = region();
    expect(live.getByText("Owed Co")).toBeInTheDocument();
    expect(live.getByText("Due Today Co")).toBeInTheDocument();
    expect(live.getByText("Past due")).toBeInTheDocument();
    expect(live.getByText("Due today")).toBeInTheDocument();
  });

  it("renders appointment tiers in the run", () => {
    stops = [stop("A")];
    meetingState.current = {
      stops: [
        {
          id: "a1",
          kind: "appointment",
          title: "Renewal review",
          dealId: "d1",
          dealName: "Acme Payments",
          startAt: "2026-08-08T13:30:00Z",
          endAt: "2026-08-08T14:00:00Z",
          lat: 30.3,
          lng: -97.7,
          address: "100 Congress Ave",
          appointmentId: "a1",
          past: false,
        },
      ],
    };
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    const live = region();
    expect(live.getByText("Renewal review")).toBeInTheDocument();
    expect(live.getByText("Appointment")).toBeInTheDocument();
  });

  it("an owed stop in the run exposes Open deal + Log drop-in firing with the right dealId", () => {
    stops = [stop("A")];
    owedState.current = { owed: [owedVisit()] };
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    const live = region();

    // Open deal navigates to the owed stop's deal.
    fireEvent.click(live.getByRole("button", { name: /open deal/i }));
    expect(navigate).toHaveBeenCalledWith("/pipeline/deal-owed-1");

    // Log drop-in opens the reused LogActivitySheet keyed by the deal id, on the
    // drop-in form - NOT the create-deal DropInSheet path. (Scope to the live
    // region: the focused native card also has a "Log drop-in" button.)
    expect(screen.queryByTestId("log-activity-sheet")).not.toBeInTheDocument();
    fireEvent.click(live.getByRole("button", { name: /log drop-in/i }));
    const sheet = screen.getByTestId("log-activity-sheet");
    expect(sheet).toHaveAttribute("data-deal", "deal-owed-1");
    expect(sheet).toHaveAttribute("data-type", "drop_in");
    expect(logActivitySheet).toHaveBeenCalledWith(
      expect.objectContaining({ dealId: "deal-owed-1", defaultType: "drop_in" }),
    );
  });

  it("keeps the native guided-run flow (skip + log drop-in) working when live tiers are present", () => {
    stops = [stop("A"), stop("B")];
    // A due-today tier is present (Open deal + Log drop-in) but we drive the
    // NATIVE card. Its "Log drop-in" sits outside the live region, so exclude the
    // region's owed button by taking the native one directly.
    dueTodayState.current = {
      dueToday: [owedVisit({ taskId: "t9", dealId: "deal-due-9", name: "Due Co", earliestAt: new Date().toISOString().slice(0, 10) })],
    };
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);

    // Native Skip still advances A → B.
    fireEvent.click(screen.getByRole("button", { name: /^skip$/i }));
    expect(setStatus).toHaveBeenCalledWith("A", "skipped");
    expect(screen.getByRole("heading", { name: "B" })).toBeInTheDocument();

    // The native focused card's Log drop-in opens the DropInSheet (native path),
    // NOT the live tier's LogActivitySheet. The native button is the full-width
    // one after the live region; pick the button that is not inside the region.
    const allLogDropIn = screen.getAllByRole("button", { name: /log drop-in/i });
    const liveRegion = screen.getByRole("region", { name: /appointments and follow-ups/i });
    const nativeLogDropIn = allLogDropIn.find((b) => !liveRegion.contains(b))!;
    expect(nativeLogDropIn).toBeDefined();
    fireEvent.click(nativeLogDropIn);
    expect(screen.getByTestId("dropin")).toBeInTheDocument();
    fireEvent.click(screen.getByText("save-log"));
    expect(screen.queryByTestId("log-activity-sheet")).not.toBeInTheDocument();
  });

  it("renders no live-tier region when there are no appointments / owed / due-today", () => {
    stops = [stop("A")];
    renderRun(<RunningPath origin={ORIGIN} onPause={vi.fn()} onViewPipeline={vi.fn()} onExit={vi.fn()} />);
    expect(screen.queryByRole("region", { name: /appointments and follow-ups/i })).not.toBeInTheDocument();
  });
});
