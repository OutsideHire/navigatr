import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Activity } from "../mockData";

// Radix Dialog needs these jsdom shims.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

vi.mock("../hooks/useUpdateActivity", () => ({
  useUpdateActivity: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../hooks/useDeleteActivity", () => ({
  useDeleteActivity: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { role: "rep" } }),
}));

import { EditActivitySheet } from "./EditActivitySheet";

function activity(over: Partial<Activity> = {}): Activity {
  return {
    id: "a-1",
    dealId: "d-1",
    type: "drop_in",
    disposition: "met_dm",
    durationMinutes: null,
    outcomeNotes: "",
    occurredAt: "2026-06-01T10:00:00.000Z",
    followUpDate: null,
    loggedBy: null,
    voiceNoteUrl: null,
    ...over,
  };
}

function renderSheet(a: Activity) {
  return render(<EditActivitySheet open onOpenChange={() => {}} activity={a} />);
}

describe("EditActivitySheet — type-specific outcomes", () => {
  it("a drop-in activity shows field-visit outcomes, not call dispositions", () => {
    renderSheet(activity({ type: "drop_in", disposition: "met_dm" }));
    expect(screen.getByText(/met with decision maker/i)).toBeInTheDocument();
    expect(screen.queryByText(/connected with dm/i)).not.toBeInTheDocument();
  });

  it("still shows a legacy call disposition stored on a drop-in activity", () => {
    // Cross-type legacy value: a call disposition on a drop_in row. The editor
    // must surface it so the rep isn't silently shown the wrong selection.
    // Rep-facing logging surfaces show the casual label ("Good conversation")
    // instead of the formal "Positive Engagement" (that stays on manager reports).
    renderSheet(activity({ type: "drop_in", disposition: "positive_engagement" }));
    expect(screen.getByText(/good conversation/i)).toBeInTheDocument();
  });
});
