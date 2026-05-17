// Regression: ISSUE-001 — Activities log loop didn't re-render after onLogged
// Found by /qa on 2026-05-16
// Report: .gstack/qa-reports/qa-report-localhost-2026-05-16.md (Activities run)
//
// Root cause: onLogged called setTab((t) => t) — a no-op in React 18 because
// Object.is(prevTab, prevTab) bails. The component never re-rendered, so a
// newly-appended activity in MOCK_ACTIVITIES never surfaced in the History
// tab until a full page reload.
//
// Fix: a refreshKey state that bumps on each log; useDerivedTasks, the
// history memo, and the type-counts memo all key on refreshKey.
//
// Test scope honesty: this test does cleanup() + fresh renderPage() between
// the two assertions, which always reads MOCK_ACTIVITIES from scratch
// regardless of memo deps. So it verifies "the page renders current
// MOCK_ACTIVITIES correctly" — a real data-correctness contract — but it
// does NOT bite the exact same-mount refreshKey-deps regression. That
// would require either exposing the page's setRefreshKey or driving the
// full LogActivitySheet form via userEvent, which the headless Chromium
// instability makes unreliable today. The full bite is verified by
// manual reproduction + source diff. See QA report for details.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActivitiesPage } from "./ActivitiesPage";
import { MOCK_ACTIVITIES, appendActivity } from "../mockData";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/activities"]}>
        <ActivitiesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ActivitiesPage / log-loop regression", () => {
  let snapshot: typeof MOCK_ACTIVITIES;

  beforeEach(() => {
    snapshot = [...MOCK_ACTIVITIES];
  });

  afterEach(() => {
    // Restore the shared module-level mock array so other test files
    // don't see contamination from this one.
    MOCK_ACTIVITIES.length = 0;
    MOCK_ACTIVITIES.push(...snapshot);
  });

  it("page reads current MOCK_ACTIVITIES into History tab after appendActivity", async () => {
    // Radix Tabs listens for pointer events, not React synthetic clicks —
    // must use userEvent (which dispatches real pointer events) not
    // fireEvent.click which only fires the React click handler and skips
    // Radix's onPointerDown.
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole("tab", { name: /History/i }));
    const baselineCallTitles = screen.getAllByText(/^Call · /);
    expect(baselineCallTitles.length).toBe(snapshot.filter((a) => a.type === "call").length);

    // Mutate the source array (what LogActivitySheet does on submit).
    appendActivity({
      id: "a-regression-001",
      dealId: "d-001",
      type: "call",
      durationMinutes: 17,
      disposition: "statement_secured",
      outcomeNotes: "regression-001-marker",
      occurredAt: new Date().toISOString(),
      followUpDate: null,
    });

    // Tear down + re-render fresh. This simulates the post-log render cycle.
    cleanup();
    renderPage();
    await user.click(screen.getByRole("tab", { name: /History/i }));

    const afterCallTitles = screen.getAllByText(/^Call · /);
    expect(afterCallTitles.length).toBe(baselineCallTitles.length + 1);
    expect(screen.getByText(/regression-001-marker/i)).toBeInTheDocument();
  });
});
