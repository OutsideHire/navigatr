import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ActivitiesPage } from "./ActivitiesPage";
import { ACTIVITIES_ORG_QUERY_KEY } from "../hooks/useActivities";
import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";
import { dateOnlyToNoonUtcIso, toDateOnly } from "@/lib/calendarDate";
import type { Activity } from "../mockData";
import type { Deal } from "@/features/pipeline/mockData";

// A follow-up due *today*, represented the way a real one is stored: noon UTC
// of today's calendar day. Using a raw `todayFollowUp()` instant
// would bucket a day off in a negative-UTC test environment.
const todayFollowUp = () => dateOnlyToNoonUtcIso(toDateOnly(new Date()));

// Radix DropdownMenu uses Pointer Capture + scrollIntoView; jsdom lacks both.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

// Mock the mutation hook so we can assert what the Snooze menu sends.
const mutate = vi.fn();
vi.mock("../hooks/useUpdateActivity", () => ({
  useUpdateActivity: () => ({ mutate }),
}));

beforeEach(() => {
  mutate.mockReset();
});

function deal(id: string, company: string): Deal {
  return {
    id,
    companyName: company,
    contactName: "X",
    phone: "+12025550100",
    email: "x@x.x",
    valueCents: 100_00,
    stage: "new",
    probability: 20,
    lastActivity: "2026-05-18T12:00:00Z",
    nextFollowup: null,
    address: null,
    employeeCountRange: "1-10",
    leadSource: "",
    updatedAt: "2026-05-18T12:00:00Z",
    owner_id: null,
    lostReasonCategory: null,
    lostReasonNotes: null,
  };
}

function task(
  id: string,
  dealId: string,
  followUpDate: string | null,
  type: Activity["type"] = "call",
): Activity {
  return {
    id,
    dealId,
    type,
    disposition: "positive_engagement",
    durationMinutes: 10,
    outcomeNotes: "notes",
    occurredAt: "2026-05-18T12:00:00Z",
    followUpDate,
  };
}

function renderWithSeed(args: { activities: Activity[]; deals: Deal[] }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(ACTIVITIES_ORG_QUERY_KEY(undefined), args.activities);
  client.setQueryData(DEALS_QUERY_KEY(undefined), args.deals);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/activities"]}>
        <ActivitiesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ActivitiesPage / Snooze menu on task rows", () => {
  it("opening a task row's Snooze menu and picking an option calls updateActivity.mutate with the task's ids and a follow-up date", async () => {
    const user = userEvent.setup();
    // A task = an activity with a non-null followUpDate, due (today) so it
    // surfaces on the default Today tab.
    renderWithSeed({
      activities: [task("a-1", "d-1", todayFollowUp())],
      deals: [deal("d-1", "Acme")],
    });

    // Open the Snooze dropdown.
    await user.click(screen.getByRole("button", { name: /Snooze/i }));
    // Pick the first option.
    await user.click(screen.getByRole("menuitem", { name: /Tomorrow/i }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const [vars] = mutate.mock.calls[0];
    expect(vars.id).toBe("a-1");
    expect(vars.dealId).toBe("d-1");
    expect(vars.patch.followUpDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("offers all three snooze options", async () => {
    const user = userEvent.setup();
    renderWithSeed({
      activities: [task("a-1", "d-1", todayFollowUp())],
      deals: [deal("d-1", "Acme")],
    });

    await user.click(screen.getByRole("button", { name: /Snooze/i }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Tomorrow/i })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /In 3 days/i })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /Next week/i })).toBeInTheDocument();
  });
});

describe("ActivitiesPage / shared type filter (above tabs)", () => {
  const todayIso = () => todayFollowUp();

  it("narrows the Today list by type and updates the Today tab count", async () => {
    const user = userEvent.setup();
    renderWithSeed({
      activities: [
        task("a-call", "d-call", todayIso(), "call"),
        task("a-mail", "d-mail", todayIso(), "email"),
      ],
      deals: [deal("d-call", "CallCo"), deal("d-mail", "MailCo")],
    });

    // Default Today tab shows both tasks.
    expect(screen.getByText("CallCo")).toBeInTheDocument();
    expect(screen.getByText("MailCo")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Today/ }).textContent).toContain("2");

    // Filter to Email — only the email-sourced task remains, count drops to 1.
    await user.click(screen.getByRole("button", { name: "Email" }));
    expect(screen.queryByText("CallCo")).not.toBeInTheDocument();
    expect(screen.getByText("MailCo")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Today/ }).textContent).toContain("1");
  });

  it("persists the selected filter when switching to the History tab", async () => {
    const user = userEvent.setup();
    renderWithSeed({
      // History-only activities (no follow-up) so they surface on History.
      activities: [
        task("h-call", "d-call", null, "call"),
        task("h-mail", "d-mail", null, "email"),
      ],
      deals: [deal("d-call", "CallCo"), deal("d-mail", "MailCo")],
    });

    await user.click(screen.getByRole("button", { name: "Email" }));
    await user.click(screen.getByRole("tab", { name: /History/ }));

    expect(screen.getByText(/MailCo/)).toBeInTheDocument();
    expect(screen.queryByText(/CallCo/)).not.toBeInTheDocument();
  });

  it("shows a clear-filter empty state when the filter matches nothing, and restores on clear", async () => {
    const user = userEvent.setup();
    renderWithSeed({
      activities: [task("a-call", "d-call", todayIso(), "call")],
      deals: [deal("d-call", "CallCo")],
    });

    await user.click(screen.getByRole("button", { name: "Email" }));
    expect(screen.getByText(/No Email here/)).toBeInTheDocument();
    expect(screen.queryByText("CallCo")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Clear filter/i }));
    expect(screen.getByText("CallCo")).toBeInTheDocument();
  });
});

describe("ActivitiesPage / edit from History", () => {
  it("tapping a History row opens the edit sheet prefilled with that activity", async () => {
    const user = userEvent.setup();
    renderWithSeed({
      // History-only activity (no follow-up) so it lives on the History tab.
      activities: [task("a-1", "d-1", null, "call")],
      deals: [deal("d-1", "Acme")],
    });

    await user.click(screen.getByRole("tab", { name: /History/ }));
    await user.click(screen.getByRole("button", { name: /Edit Call activity/i }));

    // The reused EditActivitySheet opened, prefilled with this activity's notes.
    expect(await screen.findByText("Edit activity")).toBeInTheDocument();
    expect(screen.getByDisplayValue("notes")).toBeInTheDocument();
  });

  it("tapping a Today task row's info area opens the edit sheet for the source activity", async () => {
    const user = userEvent.setup();
    // A due-today follow-up surfaces as a task on the default Today tab.
    renderWithSeed({
      activities: [task("a-1", "d-1", todayFollowUp(), "call")],
      deals: [deal("d-1", "Acme")],
    });

    // The info area is a button (Log activity + Snooze remain separate).
    await user.click(screen.getByRole("button", { name: /Edit Call activity/i }));

    expect(await screen.findByText("Edit activity")).toBeInTheDocument();
    expect(screen.getByDisplayValue("notes")).toBeInTheDocument();
  });

  it("clicking anywhere on a task row (not just the name) opens the edit sheet", async () => {
    const user = userEvent.setup();
    renderWithSeed({
      activities: [task("a-1", "d-1", todayFollowUp(), "call")],
      deals: [deal("d-1", "Acme")],
    });

    // Click the row container itself, away from the inner edit button.
    await user.click(screen.getByTestId("task-row"));

    expect(await screen.findByText("Edit activity")).toBeInTheDocument();
  });

  it("clicking Snooze on a task row does NOT open the edit sheet (propagation stopped)", async () => {
    const user = userEvent.setup();
    renderWithSeed({
      activities: [task("a-1", "d-1", todayFollowUp(), "call")],
      deals: [deal("d-1", "Acme")],
    });

    await user.click(screen.getByRole("button", { name: /Snooze/i }));

    // The snooze menu opened; the edit sheet did not.
    expect(screen.getByRole("menuitem", { name: /Tomorrow/i })).toBeInTheDocument();
    expect(screen.queryByText("Edit activity")).not.toBeInTheDocument();
  });
});

describe("ActivitiesPage / task row type indicator", () => {
  // The badge's leading span is the activity-type icon container.
  const badgeOf = (label: RegExp) =>
    screen.getByRole("button", { name: label }).querySelector("span");

  it("colors a (non-overdue) task row's icon by its activity type", () => {
    renderWithSeed({
      // Due today → not overdue → uses the email type accent.
      activities: [task("a-1", "d-1", todayFollowUp(), "email")],
      deals: [deal("d-1", "Acme")],
    });
    expect(badgeOf(/Edit Email activity/i)?.className).toContain("bg-accent-blue-20");
  });

  it("keeps the red overdue treatment on the type icon when overdue", () => {
    renderWithSeed({
      // Past follow-up → overdue → red badge regardless of type.
      activities: [task("a-1", "d-1", "2020-01-01T00:00:00.000Z", "email")],
      deals: [deal("d-1", "Acme")],
    });
    expect(badgeOf(/Edit Email activity/i)?.className).toContain("bg-status-danger");
  });
});

describe("ActivitiesPage / follow-up superseded by a later activity", () => {
  it("drops a task once a newer activity is logged on the same deal", () => {
    // Bug fix: logging an outcome should clear the deal's overdue follow-up.
    // Older activity carries a due-today follow-up; the newer touch (no
    // follow-up of its own) supersedes it, so no task row should render.
    renderWithSeed({
      activities: [
        { ...task("a-old", "d-1", todayFollowUp()), occurredAt: "2026-05-10T12:00:00Z" },
        { ...task("a-new", "d-1", null), occurredAt: "2026-05-20T12:00:00Z" },
      ],
      deals: [deal("d-1", "Acme")],
    });
    expect(screen.queryByText("Acme")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("task-row")).toHaveLength(0);
  });
});
