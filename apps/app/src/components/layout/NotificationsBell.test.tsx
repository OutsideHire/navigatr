import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import type { FollowUpReminder } from "@/features/activities/hooks/useFollowUpReminders";
import type { PathReminder } from "@/features/path/hooks/usePathReminders";
import type { Deal } from "@/features/pipeline/mockData";
import type { Activity } from "@/features/activities/mockData";

// --- jsdom polyfills for Radix dropdown portals/pointer -------------------
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

let followUps: { overdue: FollowUpReminder[]; today: FollowUpReminder[]; count: number; isLoading: boolean };
let pathReminders: { due: PathReminder[]; count: number; isLoading: boolean };
let partnerReminders = { overdue: [], today: [], count: 0, isLoading: false } as {
  overdue: { id: string; partner: { id: string; name: string; company: string }; dueAt: string; daysOverdue: number }[];
  today: { id: string; partner: { id: string; name: string; company: string }; dueAt: string; daysOverdue: number }[];
  count: number;
  isLoading: boolean;
};

vi.mock("@/features/activities/hooks/useFollowUpReminders", () => ({
  useFollowUpReminders: () => followUps,
}));
vi.mock("@/features/path/hooks/usePathReminders", () => ({
  usePathReminders: () => pathReminders,
}));
vi.mock("@/features/partners/hooks/usePartnerFollowUpReminders", () => ({
  usePartnerFollowUpReminders: () => partnerReminders,
}));

import { NotificationsBell } from "./NotificationsBell";

function makeDeal(): Deal {
  return {
    id: "deal-1",
    companyName: "Acme",
    contactName: "Jane",
    phone: "+15555555555",
    email: "j@acme.com",
    valueCents: 100_000,
    stage: "contacted",
    probability: 35,
    lastActivity: "2026-05-20T00:00:00Z",
    nextFollowup: null,
    address: null,
    employeeCountRange: "10-49",
    leadSource: "inbound",
    updatedAt: "2026-05-20T00:00:00Z",
    owner_id: null,
    lostReasonCategory: null,
    lostReasonNotes: null,
  } as Deal;
}

function makeActivity(): Activity {
  return {
    id: "act-1",
    dealId: "deal-1",
    type: "call",
    disposition: "positive_engagement",
    durationMinutes: 5,
    outcomeNotes: "",
    occurredAt: "2026-05-19T15:00:00Z",
    followUpDate: "2026-05-22T00:00:00Z",
  } as Activity;
}

function makeFollowUp(): FollowUpReminder {
  return {
    id: "fu-1",
    deal: makeDeal(),
    activity: makeActivity(),
    dueAt: "2026-05-22T00:00:00Z",
    daysOverdue: 0,
  };
}

function makePathReminder(): PathReminder {
  return {
    id: "path-1",
    path: {
      id: "path-1", date: "2026-07-01", name: "Downtown run", originLabel: "Austin, TX",
      originLat: 30, originLng: -97, status: "planned",
      reminderAt: "2026-07-01T13:30:00.000Z", startedAt: null, stopCount: 3,
      pathCalendarSyncStatus: null,
    },
    name: "Downtown run",
    date: "2026-07-01",
    reminderAt: "2026-07-01T13:30:00.000Z",
  };
}

function renderBell() {
  return render(
    <MemoryRouter>
      <NotificationsBell />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigateMock.mockClear();
  followUps = { overdue: [], today: [], count: 0, isLoading: false };
  pathReminders = { due: [], count: 0, isLoading: false };
  partnerReminders = { overdue: [], today: [], count: 0, isLoading: false };
});

describe("NotificationsBell", () => {
  it("shows the empty state with no reminders of either kind", async () => {
    const user = userEvent.setup();
    renderBell();
    await user.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });

  it("counts follow-ups and due paths together in the badge", () => {
    followUps = { overdue: [], today: [makeFollowUp()], count: 1, isLoading: false };
    pathReminders = { due: [makePathReminder()], count: 1, isLoading: false };
    renderBell();
    // aria-label reflects the merged total.
    expect(screen.getByRole("button", { name: /notifications: 2/i })).toBeInTheDocument();
  });

  it("shows a due path alongside follow-ups without dropping either", async () => {
    const user = userEvent.setup();
    followUps = { overdue: [], today: [makeFollowUp()], count: 1, isLoading: false };
    pathReminders = { due: [makePathReminder()], count: 1, isLoading: false };
    renderBell();
    await user.click(screen.getByRole("button", { name: /notifications/i }));
    // The due path.
    expect(screen.getByText("Downtown run")).toBeInTheDocument();
    // The follow-up (company name) is still present.
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });

  it("navigates to /path when a due path row is selected", async () => {
    const user = userEvent.setup();
    pathReminders = { due: [makePathReminder()], count: 1, isLoading: false };
    renderBell();
    await user.click(screen.getByRole("button", { name: /notifications/i }));
    await user.click(screen.getByText("Downtown run"));
    expect(navigateMock).toHaveBeenCalledWith("/path");
  });

  it("shows a partner cadence reminder, counts it, and navigates to the partner", async () => {
    const user = userEvent.setup();
    partnerReminders = {
      overdue: [{ id: "pA", partner: { id: "pA", name: "Auris", company: "Auris LLC" }, dueAt: "2026-07-10T12:00:00Z", daysOverdue: 5 }],
      today: [],
      count: 1,
      isLoading: false,
    };
    renderBell();
    // The partner reminder adds to the badge count.
    expect(screen.getByRole("button", { name: /notifications: 1/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /notifications/i }));
    // The partner reminder shows name, company, and the overdue label.
    expect(screen.getByText("Auris")).toBeInTheDocument();
    expect(screen.getByText("Auris LLC")).toBeInTheDocument();
    expect(screen.getByText("5d overdue")).toBeInTheDocument();
    // Selecting it navigates to the partner detail.
    await user.click(screen.getByText("Auris"));
    expect(navigateMock).toHaveBeenCalledWith("/partners/pA");
  });

  it("labels a due-today partner reminder and navigates to it", async () => {
    const user = userEvent.setup();
    partnerReminders = {
      overdue: [],
      today: [{ id: "pB", partner: { id: "pB", name: "Beta", company: "Beta LLC" }, dueAt: "2026-07-20T12:00:00Z", daysOverdue: 0 }],
      count: 1,
      isLoading: false,
    };
    renderBell();
    expect(screen.getByRole("button", { name: /notifications: 1/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /notifications/i }));
    // The due-today branch of PartnerReminderRow (label + warning styling).
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Due today")).toBeInTheDocument();
    await user.click(screen.getByText("Beta"));
    expect(navigateMock).toHaveBeenCalledWith("/partners/pB");
  });
});
