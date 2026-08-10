import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { ActivePathView } from "./ActivePathView";
import type { MeetingStop } from "../lib/meetingStops";
import type { OwedVisit } from "../lib/owedVisits";

// react-router's useNavigate, spied so we can assert "Open deal" routes to the
// deal. The component still renders inside a real MemoryRouter (renderView).
const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

// The reused appointment-outcome sheet, mocked as a sibling-visible surface so
// we can assert the appointment "Log outcome" action reaches the existing flow
// with the right ids WITHOUT rebuilding or exercising the real sheet.
const outcomeSheet = vi.fn();
vi.mock("@/features/appointments/components/AppointmentOutcomeSheet", () => ({
  AppointmentOutcomeSheet: (props: { appointmentId: string; dealId: string }) => {
    outcomeSheet(props);
    return <div data-testid="outcome-sheet" data-appt={props.appointmentId} data-deal={props.dealId} />;
  },
}));

// The reused deal-scoped activity-logging sheet, mocked like the outcome sheet
// so we can assert an owed / due-today stop's "Log drop-in" reaches the existing
// flow keyed by the deal id (and opened straight to the drop-in form).
const logActivitySheet = vi.fn();
vi.mock("@/features/activities/components/LogActivitySheet", () => ({
  LogActivitySheet: (props: { dealId: string; defaultType?: string }) => {
    logActivitySheet(props);
    return <div data-testid="log-activity-sheet" data-deal={props.dealId} data-type={props.defaultType} />;
  },
}));

const setStatus = vi.fn();
const remove = vi.fn();
const clear = vi.fn();
let complete = false;

const todayState = {
  current: {
    stops: [
      {
        merchantId: "m1",
        name: "Uratex",
        address: "Rd",
        phone: null,
        lat: 30.3,
        lng: -97.7,
        category: "manufacturing_wholesale",
        primaryType: null,
        status: "pending",
        disposition: null,
        dealCreated: false,
        addedAt: "t1",
      },
      {
        merchantId: "m2",
        name: "Amkor",
        address: "Rd2",
        phone: null,
        lat: 30.4,
        lng: -97.7,
        category: "manufacturing_wholesale",
        primaryType: null,
        status: "visited",
        disposition: "met_dm",
        dealCreated: true,
        addedAt: "t2",
      },
    ],
    setStatus,
    remove,
    clear,
    isComplete: () => complete,
  },
};

// Meeting stops (Slice 5B). Default: none, so existing tests see only the
// route stops. Individual tests override meetingState.current.stops.
const meetingState = { current: { stops: [] as MeetingStop[] } };
// Owed (past-due) + due-today live tiers (SP-C2). Default: none.
const owedState = { current: { owed: [] as OwedVisit[] } };
const dueTodayState = { current: { dueToday: [] as OwedVisit[] } };

vi.mock("../hooks/useTodayPath", () => ({
  useTodayPath: () => todayState.current,
  todayISO: () => "2026-08-08",
}));
vi.mock("../hooks/useMeetingStops", () => ({ useMeetingStops: () => meetingState.current }));
vi.mock("../hooks/useOwedVisits", () => ({ useOwedVisits: () => owedState.current }));
vi.mock("../hooks/useDueTodayVisits", () => ({ useDueTodayVisits: () => dueTodayState.current }));
vi.mock("./MerchantMap", () => ({ MerchantMap: () => <div data-testid="map" /> }));
vi.mock("./PathSummary", () => ({ PathSummary: () => <div data-testid="summary" /> }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

function renderView(props?: Partial<{ onAddStops: () => void; onStartRoute: () => void }>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ActivePathView
          origin={{ lat: 30, lng: -97 }}
          onAddStops={props?.onAddStops ?? vi.fn()}
          onStartRoute={props?.onStartRoute ?? vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setStatus.mockClear();
  remove.mockClear();
  clear.mockClear();
  navigate.mockClear();
  outcomeSheet.mockClear();
  logActivitySheet.mockClear();
  vi.mocked(toast).mockClear();
  vi.mocked(toast.success).mockClear();
  complete = false;
  meetingState.current = { stops: [] };
  owedState.current = { owed: [] };
  dueTodayState.current = { dueToday: [] };
});

/** A routable owed visit fixture (SP-C2). `earliestAt` before todayISO()
 *  ("2026-08-08") makes it PAST-DUE; equal-to would be due-today. `createdAt`
 *  five days back gives a deterministic "5d overdue" age. */
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
    targetAt: "2026-08-05",
    earliestAt: "2026-08-01",
    latestAt: "2026-08-10",
    snoozeCount: 0,
    sourceOutcome: "appt_no_show",
    createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    ...over,
  };
}

const appointmentStop: MeetingStop = {
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
  past: true,
};

const futureAppointmentStop: MeetingStop = {
  id: "a2",
  kind: "appointment",
  title: "Kickoff call",
  dealId: "d2",
  dealName: "Beta Retail",
  startAt: "2026-08-08T18:30:00Z",
  endAt: "2026-08-08T19:00:00Z",
  lat: 30.5,
  lng: -97.8,
  address: "200 Lavaca St",
  appointmentId: "a2",
  past: false,
};

const externalStop: MeetingStop = {
  id: "e1",
  kind: "external",
  title: "Team standup",
  dealId: null,
  dealName: null,
  startAt: "2026-08-08T09:00:00Z",
  endAt: "2026-08-08T09:30:00Z",
  lat: 30.1,
  lng: -97.6,
  address: "HQ conference room",
  appointmentId: null,
  past: false,
};

describe("ActivePathView", () => {
  it("renders rich rows with name, category · address, and a leg line", () => {
    renderView();
    expect(screen.getByText("Uratex")).toBeInTheDocument();
    expect(screen.getByText(/Manufacturing & Wholesale · Rd$/)).toBeInTheDocument();
    expect(screen.getByText(/From start/i)).toBeInTheDocument();
  });

  it("marks a pending stop visited via setStatus", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /mark visited/i }));
    expect(setStatus).toHaveBeenCalledWith("m1", "visited");
  });

  it("toasts on mark visited", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /mark visited/i }));
    expect(toast.success).toHaveBeenCalledWith("Marked Uratex as visited");
  });

  it("skips a pending stop via setStatus", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /^skip$/i }));
    expect(setStatus).toHaveBeenCalledWith("m1", "skipped");
  });

  it("removes a pending stop via remove", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    expect(remove).toHaveBeenCalledWith("m1");
  });

  it("reopens a resolved stop via setStatus pending", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /reopen/i }));
    expect(setStatus).toHaveBeenCalledWith("m2", "pending");
  });

  it("clears the path after confirm", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /clear path/i }));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("does not clear the path when confirm is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /clear path/i }));
    expect(clear).not.toHaveBeenCalled();
  });

  it("shows Start route when a stop is pending and calls onStartRoute", () => {
    const onStartRoute = vi.fn();
    renderView({ onStartRoute });
    fireEvent.click(screen.getByRole("button", { name: /start route/i }));
    expect(onStartRoute).toHaveBeenCalledTimes(1);
  });

  it("shows the remaining-stops summary on the Start route hero (singular)", () => {
    // Fixture has one pending stop (m1) and one visited (m2).
    renderView();
    expect(screen.getByText("1 stop to go")).toBeInTheDocument();
  });

  it("renders the summary and no stop rows when complete", () => {
    complete = true;
    renderView();
    expect(screen.getByTestId("summary")).toBeInTheDocument();
    expect(screen.queryByText("Uratex")).not.toBeInTheDocument();
  });

  it("renders appointment and external meeting stops with time, title, deal name, and ended treatment", () => {
    meetingState.current = {
      stops: [
        {
          id: "e1",
          kind: "external",
          title: "Team standup",
          dealId: null,
          dealName: null,
          startAt: "2026-08-08T09:00:00Z",
          endAt: "2026-08-08T09:30:00Z",
          lat: 30.1,
          lng: -97.6,
          address: "HQ conference room",
          appointmentId: null,
          past: true,
        },
        {
          id: "a1",
          kind: "appointment",
          title: "Renewal review",
          dealId: "d1",
          dealName: "Acme Payments",
          startAt: "2026-08-08T13:30:00Z",
          endAt: null,
          lat: 30.3,
          lng: -97.7,
          address: "100 Congress Ave",
          appointmentId: "a1",
          past: false,
        },
      ],
    };
    renderView();

    // Both meeting stops render with their titles.
    expect(screen.getByText("Team standup")).toBeInTheDocument();
    expect(screen.getByText("Renewal review")).toBeInTheDocument();

    // The appointment shows its joined deal name.
    expect(screen.getByText("Acme Payments")).toBeInTheDocument();

    // Each meeting now carries a plain reason line, not a tier / Ended chip.
    expect(screen.getAllByText(/^You have a .+ here\.$/).length).toBe(2);
    expect(screen.queryByText("Appointment")).not.toBeInTheDocument();
    expect(screen.queryByText("Ended")).not.toBeInTheDocument();

    // Each meeting shows a clock time (locale "h:mm" form).
    expect(screen.getAllByText(/\d{1,2}:\d{2}/).length).toBeGreaterThanOrEqual(2);
  });

  it("an appointment stop renders Open deal and Log outcome, and NO external actions", () => {
    meetingState.current = { stops: [appointmentStop] };
    renderView();
    expect(screen.getByRole("button", { name: /open deal/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log outcome/i })).toBeInTheDocument();
    // The appointment (no external-only actions) shows no Navigate / Mark done.
    expect(screen.queryByRole("link", { name: /navigate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark done/i })).not.toBeInTheDocument();
  });

  it("a FUTURE appointment renders Open deal but NOT Log outcome", () => {
    // Log outcome records a past-due appointment's result, so it must not
    // appear on an appointment that has not occurred yet (even with a dealId).
    meetingState.current = { stops: [futureAppointmentStop] };
    renderView();
    expect(screen.getByRole("button", { name: /open deal/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /log outcome/i })).not.toBeInTheDocument();
  });

  it("Open deal navigates to the appointment's deal", () => {
    meetingState.current = { stops: [appointmentStop] };
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /open deal/i }));
    expect(navigate).toHaveBeenCalledWith("/pipeline/d1");
  });

  it("Log outcome opens the reused AppointmentOutcomeSheet with the appointment + deal ids", () => {
    meetingState.current = { stops: [appointmentStop] };
    renderView();
    // Sheet not mounted until the action is taken.
    expect(screen.queryByTestId("outcome-sheet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /log outcome/i }));
    const sheet = screen.getByTestId("outcome-sheet");
    expect(sheet).toHaveAttribute("data-appt", "a1");
    expect(sheet).toHaveAttribute("data-deal", "d1");
    expect(outcomeSheet).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: "a1", dealId: "d1", hasFutureAppointment: false }),
    );
  });

  it("an external stop renders Navigate + Mark done but NO outcome action", () => {
    meetingState.current = { stops: [externalStop] };
    renderView();
    const nav = screen.getByRole("link", { name: /navigate/i });
    expect(nav).toHaveAttribute("href", expect.stringContaining("maps/dir"));
    expect(nav).toHaveAttribute("href", expect.stringContaining("destination=30.1%2C-97.6"));
    expect(screen.getByRole("button", { name: /mark done/i })).toBeInTheDocument();
    // External meetings never log an outcome and have no deal to open.
    expect(screen.queryByRole("button", { name: /log outcome/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open deal/i })).not.toBeInTheDocument();
  });

  it("Mark done toggles local client-only state on an external stop", () => {
    meetingState.current = { stops: [externalStop] };
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /^mark done$/i }));
    // Toggled: label flips and no persistence hook is touched.
    expect(screen.getByRole("button", { name: /mark not done/i })).toBeInTheDocument();
    expect(setStatus).not.toHaveBeenCalled();
    expect(outcomeSheet).not.toHaveBeenCalled();
    // Toggling back restores the original label.
    fireEvent.click(screen.getByRole("button", { name: /mark not done/i }));
    expect(screen.getByRole("button", { name: /^mark done$/i })).toBeInTheDocument();
  });

  // ─── SP-C2: one ordered, tiered list ──────────────────────────────────

  it("renders all four tiers in ONE list with reason lines and appointment time", () => {
    meetingState.current = { stops: [futureAppointmentStop] };
    owedState.current = { owed: [owedVisit()] };
    dueTodayState.current = {
      dueToday: [owedVisit({ taskId: "t2", dealId: "deal-due-1", name: "Due Today Co", earliestAt: "2026-08-08" })],
    };
    // Native stops come from the default todayState (Uratex pending, Amkor visited).
    renderView();

    // No tier chips - the redesign replaces them with plain reason lines.
    expect(screen.queryByText("Appointment")).not.toBeInTheDocument();
    expect(screen.queryByText("Past due")).not.toBeInTheDocument();
    expect(screen.queryByText("Due today")).not.toBeInTheDocument();
    expect(screen.queryByText("Nearby")).not.toBeInTheDocument();

    // Each tier's name is present.
    expect(screen.getByText("Kickoff call")).toBeInTheDocument(); // appointment
    expect(screen.getByText("Owed Co")).toBeInTheDocument(); // past-due
    expect(screen.getByText("Due Today Co")).toBeInTheDocument(); // due-today
    expect(screen.getByText("Uratex")).toBeInTheDocument(); // native

    // Reason lines replace the chips: appointment sentence, owed/due-today age,
    // and the native "new" line.
    expect(screen.getByText(/^You have a .+ here\.$/)).toBeInTheDocument();
    expect(screen.getAllByText("You have not stopped by in 5 days.").length).toBe(2);
    expect(screen.getAllByText("New. You have not been in.").length).toBe(2); // both native stops

    // Appointment time still renders.
    expect(screen.getAllByText(/\d{1,2}:\d{2}/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
  });

  it("a past-due owed stop exposes Open deal + Log drop-in wired to its deal", () => {
    owedState.current = { owed: [owedVisit()] };
    renderView();

    // Open deal navigates to the owed stop's deal.
    fireEvent.click(screen.getByRole("button", { name: /open deal/i }));
    expect(navigate).toHaveBeenCalledWith("/pipeline/deal-owed-1");

    // Log drop-in opens the reused LogActivitySheet keyed by the deal id, on the
    // drop-in form - NOT the create-deal path.
    expect(screen.queryByTestId("log-activity-sheet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /log drop-in/i }));
    const sheet = screen.getByTestId("log-activity-sheet");
    expect(sheet).toHaveAttribute("data-deal", "deal-owed-1");
    expect(sheet).toHaveAttribute("data-type", "drop_in");
    expect(logActivitySheet).toHaveBeenCalledWith(
      expect.objectContaining({ dealId: "deal-owed-1", defaultType: "drop_in" }),
    );
  });

  it("a due-today stop exposes Open deal + Log drop-in but NO overdue age", () => {
    dueTodayState.current = {
      dueToday: [owedVisit({ taskId: "t2", dealId: "deal-due-1", name: "Due Today Co", earliestAt: "2026-08-08" })],
    };
    renderView();
    // No tier chip; a plain reason line renders instead.
    expect(screen.queryByText("Due today")).not.toBeInTheDocument();
    expect(screen.getByText("You have not stopped by in 5 days.")).toBeInTheDocument();
    // Due-today is not overdue.
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /log drop-in/i }));
    expect(logActivitySheet).toHaveBeenCalledWith(
      expect.objectContaining({ dealId: "deal-due-1", defaultType: "drop_in" }),
    );
  });

  it("keeps native stop actions working alongside the live tiers", () => {
    owedState.current = { owed: [owedVisit()] };
    renderView();
    // The native pending stop still marks visited via setStatus.
    fireEvent.click(screen.getByRole("button", { name: /mark visited/i }));
    expect(setStatus).toHaveBeenCalledWith("m1", "visited");
  });

  // ─── R4: Show/Hide map toggle (default hidden on mobile) ────────────────

  it("defaults the map hidden on mobile (hidden md:block) and offers a Show map toggle", () => {
    renderView();
    // Desktop always shows the map via md:block; mobile starts hidden.
    const pane = screen.getByTestId("map").parentElement as HTMLElement;
    expect(pane).toHaveClass("hidden");
    expect(pane).toHaveClass("md:block");
    expect(pane).not.toHaveClass("block");
    // The single mobile toggle reads "Show map" while hidden.
    expect(screen.getByRole("button", { name: /^show map$/i })).toBeInTheDocument();
  });

  it("toggling Show map flips the mobile visibility class and the label to Hide map", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /^show map$/i }));
    const pane = screen.getByTestId("map").parentElement as HTMLElement;
    // Now visible on mobile too; md:block still present for desktop.
    expect(pane).toHaveClass("block");
    expect(pane).toHaveClass("md:block");
    expect(pane).not.toHaveClass("hidden");
    // Label flips; toggling back hides it again.
    expect(screen.getByRole("button", { name: /^hide map$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^hide map$/i }));
    expect(screen.getByTestId("map").parentElement as HTMLElement).toHaveClass("hidden");
  });
});
