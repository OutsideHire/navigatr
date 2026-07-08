// FollowupSyncIndicator — the subtle calendar-sync badge shown beside a deal's
// follow-up date on Deal Detail (Milestone 2, plan FM5).
//
// Behavior under test:
//   synced  → "On calendar" badge, no Retry
//   error   → "Not synced" badge + a Retry button that calls
//             useFollowupSync().syncFollowup(dealId)
//   pending → "Syncing…" (muted), no Retry
//   null / undefined → renders nothing
//
// useFollowupSync is mocked so the Retry assertion is a pure spy check with no
// real supabase invoke.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FollowupSyncIndicator } from "./FollowupSyncIndicator";

const { syncFollowup } = vi.hoisted(() => ({ syncFollowup: vi.fn() }));
vi.mock("@/features/appointments/useFollowupSync", () => ({
  useFollowupSync: () => ({ syncFollowup }),
}));

beforeEach(() => {
  syncFollowup.mockReset();
});

describe("FollowupSyncIndicator", () => {
  it("renders 'On calendar' for a synced follow-up and offers no Retry", () => {
    render(<FollowupSyncIndicator dealId="d-1" status="synced" />);
    expect(screen.getByText("On calendar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("renders 'Not synced' + a Retry that calls syncFollowup(dealId) for an error", async () => {
    const user = userEvent.setup();
    render(<FollowupSyncIndicator dealId="d-9" status="error" />);

    expect(screen.getByText("Not synced")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(syncFollowup).toHaveBeenCalledWith("d-9");
  });

  it("renders 'Syncing…' (no Retry) for a pending follow-up", () => {
    render(<FollowupSyncIndicator dealId="d-1" status="pending" />);
    expect(screen.getByText("Syncing…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("renders nothing when status is null", () => {
    const { container } = render(<FollowupSyncIndicator dealId="d-1" status={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when status is undefined", () => {
    const { container } = render(<FollowupSyncIndicator dealId="d-1" status={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
