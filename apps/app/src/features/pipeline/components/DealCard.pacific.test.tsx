// Bug 2 regression — the deal card renders the stored follow-up on its correct
// calendar day at UTC+12, not a day late.
//
// Runs in Pacific/Auckland (UTC+12, no DST in July). A follow-up stored at noon
// UTC of Jul 9 is 2026-07-10T00:00 local — rendering in local time (the pre-fix
// bug) showed "Jul 10", a day LATE, disagreeing with the UTC-based day heading
// and notification bell. The correct display is the stored UTC calendar day,
// "Jul 9". These assertions FAIL on the pre-fix code (they render "Jul 10").
process.env.TZ = "Pacific/Auckland";

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DealCard } from "./DealCard";
import { MOCK_DEALS, type Deal } from "../mockData";
import { dateOnlyToNoonUtcIso } from "@/lib/calendarDate";

vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { org_id: "org-1" } }),
}));

function renderCard(over: Partial<Deal>) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <DealCard deal={{ ...MOCK_DEALS[0], ...over }} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DealCard — follow-up renders on the correct day (Pacific, UTC+12)", () => {
  it("renders a noon-UTC Jul-9 follow-up as 'Jul 9', not a day late", () => {
    renderCard({ stage: "contacted", nextFollowup: dateOnlyToNoonUtcIso("2026-07-09") });
    expect(screen.getByText(/Jul 9/)).toBeInTheDocument();
    // Pre-fix local rendering pushed noon-UTC + 12h into the next day.
    expect(screen.queryByText(/Jul 10/)).not.toBeInTheDocument();
  });
});
