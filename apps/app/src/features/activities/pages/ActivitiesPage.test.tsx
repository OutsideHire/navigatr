import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ActivitiesPage } from "./ActivitiesPage";
import { ACTIVITIES_ORG_QUERY_KEY } from "../hooks/useActivities";
import { TASKS_QUERY_KEY } from "../hooks/useTasks";
import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";
import { myAppointmentsKey } from "@/features/appointments/useAppointments";
import type { ScheduledAppointment } from "@/features/appointments/types";
import { toDateOnly } from "@/lib/calendarDate";
import type { Activity } from "../mockData";
import type { Deal } from "@/features/pipeline/mockData";
import type { Task } from "../tasks/taskTypes";
import type { TaskType } from "../lib/isProspectTouch";

const todayDate = () => toDateOnly(new Date());

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

// Capture what the task mutations receive.
const snoozeMutate = vi.fn();
const completeMutate = vi.fn();
const cancelMutate = vi.fn();
vi.mock("../hooks/useTaskMutations", () => ({
  useTaskMutations: () => ({
    snoozeTask: { mutate: snoozeMutate },
    completeTask: { mutate: completeMutate },
    cancelTask: { mutate: cancelMutate },
    createTask: { mutate: vi.fn() },
  }),
}));

// Stub the external-calendar read. Default: connected, no meetings, so the
// "Today's meetings" section renders nothing and existing tests are unaffected.
// Individual tests reassign calendarState.current to seed meetings.
type CalendarState = {
  waypoints: Array<{ id: string; title: string; start: string; end: string; address: string; lat: number; lng: number; source: "calendar" }>;
  timeBlocks: Array<{ id: string; title: string; start: string; end: string; reason: "no_location" | "unmappable" }>;
  status: "ok" | "not_connected" | "needs_reconnect";
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};
const emptyCalendar = (): CalendarState => ({
  waypoints: [],
  timeBlocks: [],
  status: "ok",
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
});
const calendarState: { current: CalendarState } = { current: emptyCalendar() };
vi.mock("@/features/path/hooks/useCalendarEvents", () => ({
  useCalendarEvents: () => calendarState.current,
}));

// A today-local ISO instant at the given local hour (calendar reads are ISO).
function todayAtHour(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

beforeEach(() => {
  snoozeMutate.mockReset();
  completeMutate.mockReset();
  cancelMutate.mockReset();
  calendarState.current = emptyCalendar();
});

function deal(id: string, company: string): Deal {
  return {
    id, companyName: company, contactName: "X", phone: "+12025550100", email: "x@x.x",
    valueCents: 100_00, stage: "new", probability: 20, lastActivity: "2026-05-18T12:00:00Z",
    nextFollowup: null, address: null, employeeCountRange: "1-10", leadSource: "",
    updatedAt: "2026-05-18T12:00:00Z", owner_id: null, lostReasonCategory: null, lostReasonNotes: null,
  };
}

function makeTask(id: string, dealId: string, targetAt: string, type: TaskType = "call"): Task {
  return {
    id, orgId: "org-1", ownerId: "user-1", type, title: `Company ${dealId}`, dealId, dealName: null,
    status: "open", earliestAt: targetAt, targetAt, latestAt: targetAt, originalTargetAt: targetAt,
    dateSource: "interval", startAt: null, reminderAt: null, priority: null, repeatRule: null,
    sourceActivityId: null, sourceOutcome: "positive_engagement", snoozeCount: 0,
    excludeFromPath: false, completedAt: null, cancelledAt: null,
    createdAt: "2026-05-18", updatedAt: "2026-05-18",
  };
}

// A scheduled_appointments row for today. By default it starts at the top of
// today and ends at end-of-day, so it is "today and not yet ended" for any
// realistic run time (the Today-view placement rule). Callers override startAt
// and endAt to exercise the already-ended (de-dup) case.
function makeAppointment(
  id: string,
  dealId: string,
  title: string,
  overrides: Partial<ScheduledAppointment> = {},
): ScheduledAppointment {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return {
    id,
    dealId,
    ownerId: "user-1",
    title,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    locationAddress: null,
    locationLat: null,
    locationLng: null,
    notes: null,
    status: "scheduled",
    calendarEventId: null,
    calendarSyncStatus: "pending",
    calendarSyncError: null,
    createdAt: "2026-05-18T12:00:00Z",
    updatedAt: "2026-05-18T12:00:00Z",
    ...overrides,
  };
}

function historyActivity(id: string, dealId: string, type: Activity["type"] = "call"): Activity {
  return {
    id, dealId, type, disposition: "positive_engagement", durationMinutes: 10,
    outcomeNotes: "notes", occurredAt: "2026-05-18T12:00:00Z", followUpDate: null,
  };
}

function renderWithSeed(args: {
  tasks?: Task[];
  completedTasks?: Task[];
  activities?: Activity[];
  deals: Deal[];
  appointments?: ScheduledAppointment[];
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // userId is undefined in tests (no auth mock), so useTasks is disabled and
  // reads this seeded cache instead of hitting Supabase.
  client.setQueryData(TASKS_QUERY_KEY(undefined, "open"), args.tasks ?? []);
  client.setQueryData(TASKS_QUERY_KEY(undefined, "completed"), args.completedTasks ?? []);
  client.setQueryData(ACTIVITIES_ORG_QUERY_KEY(undefined), args.activities ?? []);
  client.setQueryData(DEALS_QUERY_KEY(undefined), args.deals);
  // useMyAppointments is likewise disabled without a userId; seed its cache.
  client.setQueryData(myAppointmentsKey(undefined), args.appointments ?? []);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/activities"]}>
        <ActivitiesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ActivitiesPage / task row actions", () => {
  it("snooze calls snoozeTask with the full task and the option's business days", async () => {
    const user = userEvent.setup();
    renderWithSeed({ tasks: [makeTask("t-1", "d-1", todayDate())], deals: [deal("d-1", "Acme")] });

    await user.click(screen.getByRole("button", { name: /Snooze/i }));
    await user.click(screen.getByRole("menuitem", { name: /Tomorrow/i }));

    expect(snoozeMutate).toHaveBeenCalledTimes(1);
    const [vars] = snoozeMutate.mock.calls[0];
    expect(vars.task.id).toBe("t-1");
    expect(vars.businessDays).toBe(1);
  });

  it("offers all three snooze options plus Cancel follow-up", async () => {
    const user = userEvent.setup();
    renderWithSeed({ tasks: [makeTask("t-1", "d-1", todayDate())], deals: [deal("d-1", "Acme")] });
    await user.click(screen.getByRole("button", { name: /Snooze/i }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Tomorrow/i })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /In 3 days/i })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Next week/i })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Cancel follow-up/i })).toBeInTheDocument();
  });

  it("Cancel follow-up calls cancelTask with the task id", async () => {
    const user = userEvent.setup();
    renderWithSeed({ tasks: [makeTask("t-1", "d-1", todayDate())], deals: [deal("d-1", "Acme")] });
    await user.click(screen.getByRole("button", { name: /Snooze/i }));
    await user.click(screen.getByRole("menuitem", { name: /Cancel follow-up/i }));
    expect(cancelMutate).toHaveBeenCalledWith("t-1", expect.anything());
  });

  it("a To-do task shows Complete, which calls completeTask", async () => {
    const user = userEvent.setup();
    renderWithSeed({ tasks: [makeTask("t-1", "d-1", todayDate(), "todo")], deals: [deal("d-1", "Acme")] });
    await user.click(screen.getByRole("button", { name: /^Complete$/i }));
    expect(completeMutate).toHaveBeenCalledWith("t-1", expect.anything());
  });

  it("a high-priority task shows a High badge", () => {
    const t = { ...makeTask("t-1", "d-1", todayDate()), priority: "high" };
    renderWithSeed({ tasks: [t], deals: [deal("d-1", "Acme")] });
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("shows a band badge and 'past target' lateness on an aging task", () => {
    // A target far in the past → band is Aging, lateness reads 'past target'.
    renderWithSeed({ tasks: [makeTask("t-1", "d-1", "2026-01-01")], deals: [deal("d-1", "Acme")] });
    expect(screen.getByText("Aging")).toBeInTheDocument();
    expect(screen.getByText(/past target/)).toBeInTheDocument();
  });
});

describe("ActivitiesPage / History", () => {
  it("shows completed to-dos alongside logged activities", async () => {
    const user = userEvent.setup();
    const doneTodo: Task = {
      ...makeTask("todo-done", "d-1", todayDate(), "todo"),
      status: "completed",
      completedAt: "2026-05-19T12:00:00Z",
      title: "Send contract",
    };
    renderWithSeed({
      completedTasks: [doneTodo],
      activities: [historyActivity("a-1", "d-1")],
      deals: [deal("d-1", "Acme")],
    });
    await user.click(screen.getByRole("tab", { name: /History/i }));
    expect(screen.getByText(/To-do · Send contract/i)).toBeInTheDocument();
  });
});

describe("ActivitiesPage / shared type filter (above tabs)", () => {
  it("narrows the Today list by type and updates the Today tab count", async () => {
    const user = userEvent.setup();
    renderWithSeed({
      tasks: [
        makeTask("t-call", "d-call", todayDate(), "call"),
        makeTask("t-mail", "d-mail", todayDate(), "email"),
      ],
      deals: [deal("d-call", "CallCo"), deal("d-mail", "MailCo")],
    });

    expect(screen.getByText("Company d-call")).toBeInTheDocument();
    expect(screen.getByText("Company d-mail")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Today/ }).textContent).toContain("2");

    await user.click(screen.getByRole("button", { name: "Email" }));
    expect(screen.queryByText("Company d-call")).not.toBeInTheDocument();
    expect(screen.getByText("Company d-mail")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Today/ }).textContent).toContain("1");
  });

  it("includes a To-do chip", () => {
    renderWithSeed({ tasks: [], deals: [] });
    expect(screen.getByRole("button", { name: "To-do" })).toBeInTheDocument();
  });

  it("persists the selected filter when switching to the History tab", async () => {
    const user = userEvent.setup();
    renderWithSeed({
      activities: [historyActivity("h-call", "d-call", "call"), historyActivity("h-mail", "d-mail", "email")],
      deals: [deal("d-call", "CallCo"), deal("d-mail", "MailCo")],
    });
    await user.click(screen.getByRole("button", { name: "Email" }));
    await user.click(screen.getByRole("tab", { name: /History/ }));
    expect(screen.getByText(/MailCo/)).toBeInTheDocument();
    expect(screen.queryByText(/CallCo/)).not.toBeInTheDocument();
  });

  it("shows a clear-filter empty state when the filter matches nothing, and restores on clear", async () => {
    const user = userEvent.setup();
    renderWithSeed({ tasks: [makeTask("t-call", "d-call", todayDate(), "call")], deals: [deal("d-call", "CallCo")] });
    await user.click(screen.getByRole("button", { name: "Email" }));
    expect(screen.getByText(/No Email here/)).toBeInTheDocument();
    expect(screen.queryByText("Company d-call")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Clear filter/i }));
    expect(screen.getByText("Company d-call")).toBeInTheDocument();
  });
});

describe("ActivitiesPage / edit from History", () => {
  it("tapping a History row opens the edit sheet prefilled with that activity", async () => {
    const user = userEvent.setup();
    renderWithSeed({ activities: [historyActivity("a-1", "d-1", "call")], deals: [deal("d-1", "Acme")] });
    await user.click(screen.getByRole("tab", { name: /History/ }));
    await user.click(screen.getByRole("button", { name: /Edit Call activity/i }));
    expect(await screen.findByText("Edit activity")).toBeInTheDocument();
    expect(screen.getByDisplayValue("notes")).toBeInTheDocument();
  });
});

describe("ActivitiesPage / task row type indicator", () => {
  const iconSpan = () => screen.getByTestId("task-row").querySelector("span");

  it("colors a (non-overdue) task row's icon by its type", () => {
    renderWithSeed({ tasks: [makeTask("t-1", "d-1", todayDate(), "email")], deals: [deal("d-1", "Acme")] });
    expect(iconSpan()?.className).toContain("bg-accent-blue-20");
  });

  it("keeps the red overdue treatment when overdue", () => {
    renderWithSeed({ tasks: [makeTask("t-1", "d-1", "2020-01-01", "email")], deals: [deal("d-1", "Acme")] });
    expect(iconSpan()?.className).toContain("bg-status-danger");
  });
});

describe("ActivitiesPage / appointment traceability", () => {
  // An appointment's `title` holds the meeting agenda, so the deal name must
  // come from the joined `dealName`. The row has to name the deal (QA fix) the
  // same way call/drop-in rows do, and keep the agenda visible too.
  it("names the deal on an appointment row and keeps the agenda", () => {
    const appt: Task = {
      ...makeTask("t-appt", "d-appt", todayDate(), "appointment"),
      title: "Q3 pricing review",
      dealName: "Acme Co",
    };
    renderWithSeed({ tasks: [appt], deals: [deal("d-appt", "Acme Co")] });

    const row = screen.getByTestId("task-row");
    expect(within(row).getByText("Acme Co")).toBeInTheDocument();
    expect(within(row).getByText("Q3 pricing review")).toBeInTheDocument();
  });

  it("falls back to the title when an appointment has no joined deal name", () => {
    const appt: Task = {
      ...makeTask("t-appt", "d-appt", todayDate(), "appointment"),
      title: "Walk-in meeting",
      dealName: null,
    };
    renderWithSeed({ tasks: [appt], deals: [deal("d-appt", "Acme Co")] });

    const row = screen.getByTestId("task-row");
    expect(within(row).getByText("Walk-in meeting")).toBeInTheDocument();
  });
});

describe("ActivitiesPage / Today's meetings (external calendar)", () => {
  it("lists today's external meetings (located + unlocated) in start-time order", () => {
    // Waypoint at 3pm, time block at 9am. Input order is late-then-early; the
    // section must sort by start so the 9am meeting renders first.
    calendarState.current = {
      ...emptyCalendar(),
      waypoints: [
        {
          id: "w-1",
          title: "Afternoon Sync",
          start: todayAtHour(15),
          end: todayAtHour(16),
          address: "123 Main St",
          lat: 1,
          lng: 2,
          source: "calendar",
        },
      ],
      timeBlocks: [
        { id: "b-1", title: "Morning Standup", start: todayAtHour(9), end: todayAtHour(10), reason: "no_location" },
      ],
    };
    renderWithSeed({ tasks: [], deals: [] });

    const section = screen.getByRole("region", { name: /Today's meetings/i });
    // Both meetings render, and the located one shows its address.
    expect(within(section).getByText("Morning Standup")).toBeInTheDocument();
    expect(within(section).getByText("Afternoon Sync")).toBeInTheDocument();
    expect(within(section).getByText(/123 Main St/)).toBeInTheDocument();

    // Start-time order: 9am standup precedes 3pm sync in the DOM.
    const titles = within(section).getAllByText(/Morning Standup|Afternoon Sync/);
    expect(titles.map((el) => el.textContent)).toEqual(["Morning Standup", "Afternoon Sync"]);
  });

  it("renders no meetings section when there are none", () => {
    renderWithSeed({ tasks: [], deals: [] });
    expect(screen.queryByRole("region", { name: /Today's meetings/i })).not.toBeInTheDocument();
  });

  it("renders no meetings section when the calendar needs reconnect", () => {
    // A failed/disconnected read degrades to empty arrays; the section is absent
    // (non-blocking, no scary error).
    calendarState.current = { ...emptyCalendar(), status: "needs_reconnect" };
    renderWithSeed({ tasks: [], deals: [] });
    expect(screen.queryByRole("region", { name: /Today's meetings/i })).not.toBeInTheDocument();
  });
});

describe("ActivitiesPage / task with an unavailable deal", () => {
  // A task whose deal is not in the loaded org deals (deleted, or moved out of
  // scope) can only be dismissed, and the note must not mislabel a real task as
  // "Sample data" (staging QA finding, 2026-08-27).
  it("explains the orphaned deal, does not say 'Sample data', and offers Dismiss", () => {
    renderWithSeed({ tasks: [makeTask("t-orphan", "d-missing", todayDate())], deals: [deal("d-other", "Acme")] });
    const row = screen.getByTestId("task-row");
    expect(within(row).getByText(/linked deal isn't in your workspace/i)).toBeInTheDocument();
    expect(within(row).queryByText(/sample data/i)).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /Dismiss/i })).toBeInTheDocument();
  });
});

describe("ActivitiesPage / empty", () => {
  it("renders no task rows when there are no open tasks", () => {
    renderWithSeed({ tasks: [], deals: [deal("d-1", "Acme")] });
    expect(screen.queryAllByTestId("task-row")).toHaveLength(0);
  });
});

describe("ActivitiesPage / drop-in merchant name (QF-2)", () => {
  // A drop-in task's `title` is free text the rep typed ("Swing by in person"),
  // not the merchant. The row must show the deal's business name as its
  // identity, keeping the typed title as a secondary agenda line.
  it("shows the merchant (deal) name on a drop-in row, not just the typed title", () => {
    const dropIn: Task = {
      ...makeTask("t-drop", "d-drop", todayDate(), "drop_in"),
      title: "Swing by in person",
      dealName: "Merchant X",
    };
    renderWithSeed({ tasks: [dropIn], deals: [deal("d-drop", "Merchant X")] });

    const row = screen.getByTestId("task-row");
    expect(within(row).getByText("Merchant X")).toBeInTheDocument();
    expect(within(row).getByText("Swing by in person")).toBeInTheDocument();
  });
});

describe("ActivitiesPage / booked appointments in Today (QF-3)", () => {
  it("surfaces a today booked appointment as a row with the merchant name", () => {
    renderWithSeed({
      tasks: [],
      deals: [deal("d-appt", "Acme Co")],
      appointments: [makeAppointment("appt-1", "d-appt", "Kickoff meeting")],
    });

    const section = screen.getByRole("region", { name: /Booked appointments/i });
    expect(within(section).getByText("Acme Co")).toBeInTheDocument();
    expect(within(section).getByText("Kickoff meeting")).toBeInTheDocument();
  });

  it("does not list an appointment that has already ended (owned by the awaiting-outcome nudge)", () => {
    // Started and ended earlier today: excluded here so it is not double-placed.
    const endedStart = new Date();
    endedStart.setHours(0, 0, 0, 0);
    const endedEnd = new Date();
    endedEnd.setHours(0, 1, 0, 0);
    renderWithSeed({
      tasks: [],
      deals: [deal("d-appt", "Acme Co")],
      appointments: [
        makeAppointment("appt-past", "d-appt", "Old meeting", {
          startAt: endedStart.toISOString(),
          endAt: endedEnd.toISOString(),
        }),
      ],
    });

    expect(screen.queryByRole("region", { name: /Booked appointments/i })).not.toBeInTheDocument();
  });

  it("hides booked appointments under a non-appointment type filter", async () => {
    const user = userEvent.setup();
    renderWithSeed({
      tasks: [],
      deals: [deal("d-appt", "Acme Co")],
      appointments: [makeAppointment("appt-1", "d-appt", "Kickoff meeting")],
    });

    expect(screen.getByRole("region", { name: /Booked appointments/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Email" }));
    expect(screen.queryByRole("region", { name: /Booked appointments/i })).not.toBeInTheDocument();
  });
});
