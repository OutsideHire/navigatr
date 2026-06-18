// Covers the file-private LatestActivityCard behavior via the page:
//   - renders at most 3 activity rows even when more exist
//   - shows an empty state (no crash) when there are none
//
// We mock useDeal + useActivities so the page mounts deterministically
// without auth/network. The Latest activity card lives in the right rail
// and slices the activities array to 3.

import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MOCK_DEALS } from "../mockData";
import type { Activity } from "@/features/activities/mockData";

// ── Mocks ────────────────────────────────────────────────────────────────
const validDeal = MOCK_DEALS[0];

vi.mock("../hooks/useDeal", () => ({
  useDeal: () => ({ deal: validDeal, isLoading: false }),
}));

const activitiesMock = vi.fn<() => { data: Activity[] }>();
vi.mock("@/features/activities/hooks/useActivities", () => ({
  useActivities: () => activitiesMock(),
}));

// Import after mocks are registered.
import { DealDetailPage } from "./DealDetailPage";

function makeActivity(id: string): Activity {
  return {
    id,
    dealId: validDeal.id,
    type: "call",
    durationMinutes: 5,
    disposition: "positive_engagement",
    outcomeNotes: `Note ${id}`,
    occurredAt: new Date("2026-04-30T12:00:00Z").toISOString(),
    followUpDate: null,
    loggedBy: null,
    voiceNoteUrl: null,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/pipeline/${validDeal.id}`]}>
        <Routes>
          <Route path="/pipeline/:dealId" element={<DealDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// The "Latest activity" card is identified by its heading; we scope row
// queries to its enclosing card to avoid counting the full Activity tab.
function latestActivityCard(): HTMLElement {
  const heading = screen.getByText(/Latest activity/i);
  // DOM: Card > [ header div (heading + View all), rows/empty-state ].
  // heading.parentElement is the header div; its parent is the Card, which
  // also contains the rows / empty state as siblings of the header.
  const card = heading.parentElement?.parentElement;
  expect(card).toBeTruthy();
  return card as HTMLElement;
}

describe("DealDetailPage / LatestActivityCard", () => {
  beforeEach(() => {
    activitiesMock.mockReset();
  });

  it("renders at most 3 activity rows when more exist", () => {
    const five = ["a1", "a2", "a3", "a4", "a5"].map(makeActivity);
    activitiesMock.mockReturnValue({ data: five });
    renderPage();

    const card = latestActivityCard();
    // Each activity row renders a "Call · … min · …" title. Count them
    // within the Latest activity card only.
    const rows = within(card).getAllByText(/^Call ·/);
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(rows.length).toBe(3);
  });

  it("shows an empty state and does not crash when there are none", () => {
    activitiesMock.mockReturnValue({ data: [] });
    expect(() => renderPage()).not.toThrow();

    const card = latestActivityCard();
    expect(within(card).getByText(/No activity yet/i)).toBeInTheDocument();
  });
});
