import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ActivitiesPage } from "./ActivitiesPage";
import { ACTIVITIES_ORG_QUERY_KEY } from "../hooks/useActivities";
import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";
import type { Activity } from "../mockData";
import type { Deal } from "@/features/pipeline/mockData";

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
      activities: [task("a-1", "d-1", new Date().toISOString())],
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
      activities: [task("a-1", "d-1", new Date().toISOString())],
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
  const todayIso = () => new Date().toISOString();

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
