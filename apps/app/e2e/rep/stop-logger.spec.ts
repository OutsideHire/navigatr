import { test, expect } from "@playwright/test";

/**
 * Golden path #7: the running-path STOP LOGGER shows the right drop-in outcomes,
 * and logging one persists.
 *
 * This is the exact screen the 2026-09 drop-in-outcomes regression lived on. When
 * a rep runs a Path and taps "I'm here" on an OWED stop (a return visit owed to an
 * existing deal), the app opens LogActivitySheet with the drop-in outcome set, NOT
 * the nearby-prospect DropInSheet that golden path #2 (dropin-fanout) covers. The
 * two sheets read the same outcome list today, but they are DIFFERENT components
 * reached by DIFFERENT cards: an Aug-2026 driving-view redesign silently
 * re-pointed this stop at LogActivitySheet, and a later outcome fix touched only
 * DropInSheet, so the stop logger drifted to a stale list (it dropped "Got their
 * statement" and added "Other") while every mocked unit test AND the DropInSheet
 * golden path stayed green. A unit test now pins LogActivitySheet's rendered list;
 * this walks the whole seam in a real browser against a local Supabase so a future
 * flow swap (this stop re-pointed at yet another component) fails here too.
 *
 * Runs as its own seeded rep (repstoplogger), who OWNS a deal with a past-due owed
 * drop-in follow-up so the running view fronts an OWED card. Inline login (no
 * shared storageState) because logging the outcome mutates the rep's data, the
 * same isolation reason carousel-carry runs as its own rep.
 */
test("running-path stop logger shows the drop-in outcomes and logs one against the owed deal", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("repstoplogger@navigatr.test");
  await page.getByLabel("Password").fill("navigatr123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

  // Warm the profile/org cache, then go to Path without a full reload: logging an
  // activity needs profile.org_id, and the Path day renders before that query
  // settles, so a cold reload to /path could race it (see dropin-fanout's header).
  await page.goto("/pipeline");
  await expect(page.getByRole("heading", { name: "Pipeline", exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: "Path", exact: true }).click();

  // The running view rendered (the seed pre-starts the path with a pending stop).
  await expect(page.getByText(/Path active ·/)).toBeVisible({ timeout: 20_000 });

  // The OWED card sorts ahead of the nearby stop, so it fronts the carousel; its
  // "I'm here" opens the stop logger (LogActivitySheet), not the nearby DropInSheet.
  const imHere = page.getByRole("button", { name: /i'm here/i });
  await expect(imHere).toBeVisible({ timeout: 20_000 });
  await imHere.click();

  // Scope every assertion to the open sheet so nothing behind the overlay matches.
  const sheet = page.getByRole("dialog");
  const commit = sheet.getByRole("button", { name: "Log activity" });

  // Prove this is the STOP LOGGER (LogActivitySheet), not the nearby DropInSheet:
  // LogActivitySheet's commit button reads "Log activity"; DropInSheet's is "Log
  // Stop". Keying on the button is the cleanest discriminator (the two share the
  // outcome tile labels).
  await expect(commit).toBeVisible();
  await expect(sheet.getByRole("button", { name: /log stop/i })).toHaveCount(0);

  // The regression guard, at the browser level: the desired-outcome tile the stale
  // list DROPPED must be present, and the "Other" tile it wrongly ADDED must be
  // gone. Both were verified to fail on the old list by the LogActivitySheet unit
  // test; this asserts the same invariant on the real running-path screen.
  await expect(sheet.getByText("Got their statement")).toBeVisible();
  await expect(sheet.getByText("Other", { exact: true })).toHaveCount(0);

  // Robert QA (2026-09): each drop-in outcome shows its follow-up timing here,
  // same as the nearby-stop DropInSheet. A fixed-interval outcome shows an N-day
  // line; "Asked me to come back" shows the pick-a-date cue.
  await expect(sheet.getByText(/\d+-day follow-up/i).first()).toBeVisible();
  await expect(sheet.getByText("You pick the date")).toBeVisible();

  // Pick it and log; assert the activity really POSTs (not just that the sheet
  // closed), arming the wait BEFORE the click that triggers it.
  await sheet.getByText("Got their statement").click();
  const activityPosted = page.waitForResponse(
    (r) => r.url().includes("/rest/v1/activities") && r.request().method() === "POST",
    { timeout: 15_000 },
  );
  await commit.click();
  const resp = await activityPosted;
  expect(resp.ok(), `activity log POST failed: ${resp.status()}`).toBeTruthy();
});
