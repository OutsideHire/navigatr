// Bug D regression — the deal card renders the stored expected-close/follow-up
// on its correct calendar day.
//
// Runs in America/Los_Angeles. A follow-up stored at noon UTC of Jul 9 must
// render "Jul 9". The pre-fix representation (UTC midnight) rendered "Jul 8"
// for a rep west of UTC — this pins the difference.
process.env.TZ = "America/Los_Angeles";

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DealCard } from "./DealCard";
import { formatShortDate, MOCK_DEALS, type Deal } from "../mockData";
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

describe("DealCard — expected close renders on the correct day (Americas)", () => {
  it("renders a noon-UTC Jul-9 follow-up as 'Jul 9'", () => {
    renderCard({ stage: "contacted", nextFollowup: dateOnlyToNoonUtcIso("2026-07-09") });
    expect(screen.getByText(/Jul 9/)).toBeInTheDocument();
    // Sanity: the buggy UTC-midnight representation would have shown Jul 8.
    expect(screen.queryByText(/Jul 8/)).not.toBeInTheDocument();
  });

  it("renders a MIDNIGHT-UTC follow-up (DB-trigger representation) as its UTC day", () => {
    // The `activities_sync_deal_denorm` trigger writes next_followup_at as
    // `follow_up_date::timestamptz` = MIDNIGHT UTC. For Jul 10 that is
    // 2026-07-10T00:00:00Z, which in Los Angeles is Jul 9 17:00. Rendering in
    // local time (the pre-fix bug) showed "Jul 9" — a day early. The correct
    // display is the stored UTC calendar day, "Jul 10".
    renderCard({ stage: "contacted", nextFollowup: "2026-07-10T00:00:00.000Z" });
    expect(screen.getByText(/Jul 10/)).toBeInTheDocument();
    expect(screen.queryByText(/Jul 9/)).not.toBeInTheDocument();
  });

  it("documents the off-by-one the fix removes", () => {
    // Same calendar date, two representations, rendered in a US timezone.
    expect(formatShortDate(dateOnlyToNoonUtcIso("2026-07-09"))).toBe("Jul 9");
    expect(formatShortDate(new Date("2026-07-09").toISOString())).toBe("Jul 8");
  });
});
