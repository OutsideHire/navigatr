import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLiveDayTiers } from "./useLiveDayTiers";
import { TieredStopList } from "../components/TieredStopList";
import type { MeetingStop } from "../lib/meetingStops";
import type { OwedVisit } from "../lib/owedVisits";

// The three LIVE data sources, mocked with mutable state (default: none).
const meetingState = { current: { stops: [] as MeetingStop[] } };
const owedState = { current: { owed: [] as OwedVisit[] } };
const dueTodayState = { current: { dueToday: [] as OwedVisit[] } };
vi.mock("./useMeetingStops", () => ({ useMeetingStops: () => meetingState.current }));
vi.mock("./useOwedVisits", () => ({ useOwedVisits: () => owedState.current }));
vi.mock("./useDueTodayVisits", () => ({ useDueTodayVisits: () => dueTodayState.current }));

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

const outcomeSheet = vi.fn();
vi.mock("@/features/appointments/components/AppointmentOutcomeSheet", () => ({
  AppointmentOutcomeSheet: (props: { appointmentId: string; dealId: string }) => {
    outcomeSheet(props);
    return <div data-testid="outcome-sheet" data-appt={props.appointmentId} data-deal={props.dealId} />;
  },
}));
const logActivitySheet = vi.fn();
vi.mock("@/features/activities/components/LogActivitySheet", () => ({
  LogActivitySheet: (props: { dealId: string; defaultType?: string; onLogged?: () => void }) => {
    logActivitySheet(props);
    return (
      <div data-testid="log-activity-sheet" data-deal={props.dealId} data-type={props.defaultType}>
        <button onClick={() => props.onLogged?.()}>fire-logged</button>
      </div>
    );
  },
}));

const PATH_DATE = "2026-08-08";

/** Harness: renders the hook's rows + sheets so we can exercise real wiring. */
function Harness() {
  const { rows, sheets, counts } = useLiveDayTiers(PATH_DATE);
  return (
    <div>
      <TieredStopList rows={rows} />
      {sheets}
      <span data-testid="counts">{`${counts.appointments}/${counts.pastDue}/${counts.dueToday}`}</span>
    </div>
  );
}

let client: QueryClient;
function renderHarness() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

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
    earliestAt: "2026-08-01", // strictly before PATH_DATE → past-due
    latestAt: "2026-08-10",
    snoozeCount: 0,
    sourceOutcome: "appt_no_show",
    createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    ...over,
  };
}

const pastAppointment: MeetingStop = {
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

beforeEach(() => {
  navigate.mockClear();
  outcomeSheet.mockClear();
  logActivitySheet.mockClear();
  meetingState.current = { stops: [] };
  owedState.current = { owed: [] };
  dueTodayState.current = { dueToday: [] };
});

describe("useLiveDayTiers", () => {
  it("returns no rows when every tier is empty", () => {
    renderHarness();
    expect(screen.getByTestId("counts")).toHaveTextContent("0/0/0");
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("keeps only the strictly-before-today owed slice as past-due", () => {
    owedState.current = {
      owed: [
        owedVisit({ taskId: "past", earliestAt: "2026-08-01" }),
        // equal-to-today belongs to the due-today band, so it is NOT past-due here.
        owedVisit({ taskId: "sameday", dealId: "deal-2", name: "Same Day Co", earliestAt: PATH_DATE }),
      ],
    };
    renderHarness();
    // Only the truly-overdue one is a past-due row.
    expect(screen.getByTestId("counts")).toHaveTextContent("0/1/0");
    expect(screen.getByText("Owed Co")).toBeInTheDocument();
    expect(screen.queryByText("Same Day Co")).not.toBeInTheDocument();
    // The tier chip + "Nd overdue" age are replaced by a plain reason line.
    expect(screen.queryByText("Past due")).not.toBeInTheDocument();
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
    // createdAt is 5 days ago in the fixture.
    expect(screen.getByText("You have not stopped by in 5 days.")).toBeInTheDocument();
  });

  it("an appointment row shows a reason line instead of any tier / Ended chip", () => {
    meetingState.current = { stops: [pastAppointment] };
    renderHarness();
    // The reason sentence renders (exact clock time is tz-dependent).
    expect(screen.getByText(/^You have a .+ here\.$/)).toBeInTheDocument();
    // No tier chip and no "Ended" chip on the row.
    expect(screen.queryByText("Appointment")).not.toBeInTheDocument();
    expect(screen.queryByText("From calendar")).not.toBeInTheDocument();
    expect(screen.queryByText("Ended")).not.toBeInTheDocument();
    expect(screen.queryByText("Past due")).not.toBeInTheDocument();
    expect(screen.queryByText("Due today")).not.toBeInTheDocument();
  });

  it("a due-today row shows a reason line instead of the Due today chip", () => {
    dueTodayState.current = {
      dueToday: [owedVisit({ taskId: "t2", dealId: "deal-due-1", name: "Due Today Co", earliestAt: PATH_DATE })],
    };
    renderHarness();
    expect(screen.getByTestId("counts")).toHaveTextContent("0/0/1");
    expect(screen.getByText("Due Today Co")).toBeInTheDocument();
    expect(screen.queryByText("Due today")).not.toBeInTheDocument();
    // createdAt is 5 days ago in the fixture; datePromisedToday stays false.
    expect(screen.getByText("You have not stopped by in 5 days.")).toBeInTheDocument();
  });

  it("orders appointments, then past-due, then due-today", () => {
    meetingState.current = { stops: [{ ...pastAppointment, past: false }] };
    owedState.current = { owed: [owedVisit()] };
    dueTodayState.current = {
      dueToday: [owedVisit({ taskId: "t2", dealId: "deal-due-1", name: "Due Today Co", earliestAt: PATH_DATE })],
    };
    renderHarness();
    expect(screen.getByTestId("counts")).toHaveTextContent("1/1/1");
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Renewal review")).toBeInTheDocument();
    expect(within(items[1]).getByText("Owed Co")).toBeInTheDocument();
    expect(within(items[2]).getByText("Due Today Co")).toBeInTheDocument();
  });

  it("an owed row's Open deal navigates and Log drop-in opens the deal-keyed sheet", () => {
    owedState.current = { owed: [owedVisit()] };
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: /open deal/i }));
    expect(navigate).toHaveBeenCalledWith("/pipeline/deal-owed-1");

    expect(screen.queryByTestId("log-activity-sheet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /log drop-in/i }));
    const sheet = screen.getByTestId("log-activity-sheet");
    expect(sheet).toHaveAttribute("data-deal", "deal-owed-1");
    expect(sheet).toHaveAttribute("data-type", "drop_in");
  });

  it("logging a drop-in invalidates the owed + due-today query keys", () => {
    owedState.current = { owed: [owedVisit()] };
    renderHarness();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(screen.getByRole("button", { name: /log drop-in/i }));
    fireEvent.click(screen.getByRole("button", { name: /fire-logged/i }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["path", "owed-visits"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["path", "due-today-visits"] });
  });

  it("a PAST appointment exposes Log outcome, wiring the reused sheet with the ids", () => {
    meetingState.current = { stops: [pastAppointment] };
    renderHarness();
    expect(screen.queryByTestId("outcome-sheet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /log outcome/i }));
    const sheet = screen.getByTestId("outcome-sheet");
    expect(sheet).toHaveAttribute("data-appt", "a1");
    expect(sheet).toHaveAttribute("data-deal", "d1");
    expect(outcomeSheet).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: "a1", dealId: "d1", hasFutureAppointment: false }),
    );
  });

  it("a FUTURE appointment exposes Open deal but NOT Log outcome", () => {
    meetingState.current = { stops: [{ ...pastAppointment, past: false }] };
    renderHarness();
    expect(screen.getByRole("button", { name: /open deal/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /log outcome/i })).not.toBeInTheDocument();
  });
});
