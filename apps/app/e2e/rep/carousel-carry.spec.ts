import { test, expect } from "@playwright/test";

/**
 * Golden path #6: the in-field driving carousel + carry-to-tomorrow.
 *
 * The loop a rep runs in the car: resolve the current stop and advance, then
 * end the route carrying unfinished stops to tomorrow. RunningPath.test is deep
 * but entirely mocked; nothing exercised the real advance + the carry mutation
 * (which reparents pending path_stops onto tomorrow's path and completes
 * today's). A break would strand the rep mid-route or lose carried stops.
 *
 * Runs as its own seeded rep (repcarousel), because carry mutates the path and
 * would otherwise clobber the repe2e specs that share a path in this job.
 * Advance is driven with "Skip for now" (purely local, deterministic); the
 * carry is asserted with a service-role read of tomorrow's path.
 */
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const REP_ID = "5eed0000-0000-4000-8000-00000000000f"; // repcarousel

async function svcSelect(table: string, query: string): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`PostgREST ${table} ${res.status}: ${await res.text()}`);
  return (await res.json()) as Array<Record<string, unknown>>;
}

/** Local yyyy-mm-dd N days from today, matching the app's addDaysISO. */
function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

test("skipping advances the carousel, then End route carries unfinished stops to tomorrow", async ({ page }) => {
  test.skip(!SUPABASE_URL || !SERVICE_KEY, "needs local Supabase URL + service-role key (CI only)");

  await page.goto("/login");
  await page.getByLabel("Work email").fill("repcarousel@navigatr.test");
  await page.getByLabel("Password").fill("navigatr123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

  await page.goto("/path");
  const statusRow = page.getByText(/Path active ·/);
  await expect(statusRow).toBeVisible({ timeout: 20_000 });

  // Advance: skip the current stop and assert the counter moved (delta-based,
  // so it holds regardless of the starting counts).
  const before = (await statusRow.innerText()).match(/(\d+)\/(\d+)/);
  if (!before) throw new Error(`could not parse the status counter: got "${await statusRow.innerText()}"`);
  const done = Number(before[1]);
  const total = Number(before[2]);
  await page.getByRole("button", { name: /skip for now/i }).click();
  await expect(page.getByText(new RegExp(`Path active · ${done + 1}/${total} stops`))).toBeVisible({ timeout: 10_000 });

  // End the route, carrying the unfinished stops to tomorrow.
  await page.getByRole("button", { name: /end route/i }).click();
  await page.getByRole("button", { name: /carry \d+ to tomorrow/i }).click();

  // The carried stops really landed on tomorrow's path (planned, still pending).
  const tomorrow = isoPlusDays(1);
  await expect
    .poll(
      async () => {
        const rows = await svcSelect(
          "paths",
          `user_id=eq.${REP_ID}&path_date=eq.${tomorrow}&select=id,status,path_stops(id,status)`,
        );
        const p = rows[0];
        if (!p) return 0;
        const stops = (p.path_stops as Array<{ status: string }> | undefined) ?? [];
        return stops.filter((s) => s.status === "pending").length;
      },
      { timeout: 15_000, message: "carried stops should appear on tomorrow's path" },
    )
    .toBeGreaterThanOrEqual(1);

  const tomorrowPath = await svcSelect("paths", `user_id=eq.${REP_ID}&path_date=eq.${tomorrow}&select=status`);
  expect(tomorrowPath[0]?.status).toBe("planned");
});
