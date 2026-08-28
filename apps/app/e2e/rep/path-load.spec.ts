import { test, expect } from "@playwright/test";

/**
 * Golden path #1: authenticated rep opens today's Path.
 *
 * The rep's home screen and the smoke test for the whole rep app. The unit
 * tests cover PathPage's location states in isolation; nothing loads the real
 * page with a seeded day through the useActivePath -> RunningPath seam. A break
 * there (blank render, stuck spinner, false empty-day) would ship green and the
 * rep could not start their day.
 *
 * The seed gives repe2e a today's Path with two pending nearby stops, so the
 * page must land in the running view (not the "No stops today" empty state).
 */
test("rep opens today's Path and sees the seeded running day, not the empty state", async ({ page }) => {
  await page.goto("/path");

  // The running view is up: the active-day status line renders.
  await expect(page.getByText(/path active/i)).toBeVisible({ timeout: 20_000 });

  // The current nearby stop offers the drop-in entry point.
  await expect(page.getByRole("button", { name: /i'm here/i })).toBeVisible();

  // It is NOT the empty landing.
  await expect(page.getByText(/no stops today/i)).toHaveCount(0);
});
