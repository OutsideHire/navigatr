// PathBlockSyncIndicator — the subtle calendar-sync badge shown on each planned
// path row in Upcoming paths (Milestone 3, plan PM5).
//
// Behavior under test:
//   synced  → "On calendar" badge, no Retry
//   error   → "Not synced" badge + a Retry button that calls
//             usePathCalendarSync().syncPath(pathId)
//   pending → "Syncing…" (muted), no Retry
//   null / undefined → renders nothing
//
// usePathCalendarSync is mocked so the Retry assertion is a pure spy check with
// no real supabase invoke.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PathBlockSyncIndicator } from "./PathBlockSyncIndicator";

const { syncPath } = vi.hoisted(() => ({ syncPath: vi.fn() }));
vi.mock("../hooks/usePathCalendarSync", () => ({
  usePathCalendarSync: () => ({ syncPath }),
}));

beforeEach(() => {
  syncPath.mockReset();
});

describe("PathBlockSyncIndicator", () => {
  it("renders 'On calendar' for a synced path and offers no Retry", () => {
    render(<PathBlockSyncIndicator pathId="p-1" status="synced" />);
    expect(screen.getByText("On calendar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("renders 'Not synced' + a Retry that calls syncPath(pathId) for an error", async () => {
    const user = userEvent.setup();
    render(<PathBlockSyncIndicator pathId="p-9" status="error" />);

    expect(screen.getByText("Not synced")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(syncPath).toHaveBeenCalledWith("p-9");
  });

  it("renders 'Syncing…' (no Retry) for a pending path", () => {
    render(<PathBlockSyncIndicator pathId="p-1" status="pending" />);
    expect(screen.getByText("Syncing…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("renders nothing when status is null", () => {
    const { container } = render(<PathBlockSyncIndicator pathId="p-1" status={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when status is undefined", () => {
    const { container } = render(<PathBlockSyncIndicator pathId="p-1" status={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
