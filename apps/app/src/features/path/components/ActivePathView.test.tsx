import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { ActivePathView } from "./ActivePathView";
import type { MeetingStop } from "../lib/meetingStops";

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

vi.mock("../hooks/useTodayPath", () => ({
  useTodayPath: () => todayState.current,
  todayISO: () => "2026-08-08",
}));
vi.mock("../hooks/useMeetingStops", () => ({ useMeetingStops: () => meetingState.current }));
vi.mock("./MerchantMap", () => ({ MerchantMap: () => <div data-testid="map" /> }));
vi.mock("./PathSummary", () => ({ PathSummary: () => <div data-testid="summary" /> }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

function renderView(props?: Partial<{ onAddStops: () => void; onStartRoute: () => void }>) {
  return render(
    <MemoryRouter>
      <ActivePathView
        origin={{ lat: 30, lng: -97 }}
        onAddStops={props?.onAddStops ?? vi.fn()}
        onStartRoute={props?.onStartRoute ?? vi.fn()}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setStatus.mockClear();
  remove.mockClear();
  clear.mockClear();
  navigate.mockClear();
  outcomeSheet.mockClear();
  vi.mocked(toast).mockClear();
  vi.mocked(toast.success).mockClear();
  complete = false;
  meetingState.current = { stops: [] };
});

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

    // A live appointment is labelled; the past meeting shows the ended treatment.
    expect(screen.getByText("Appointment")).toBeInTheDocument();
    expect(screen.getByText("Ended")).toBeInTheDocument();

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
});
