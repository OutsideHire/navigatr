import { test, expect } from "@playwright/test";

/**
 * Golden path #2: a drop-in outcome really creates a pipeline deal.
 *
 * The core value moment. The unit test for DropInSheet mocks useCreateDeal /
 * useLogActivity, so it only proves the sheet CALLS them, not that a deal
 * actually lands. This walks the whole seam against a real local Supabase:
 * open the current nearby stop, log a follow-up outcome, and confirm the deal
 * is persisted (the create POST succeeds) and shows up on the pipeline board.
 * If a break here closed the sheet with a success toast while the deal silently
 * never appeared (the exact class of the bug that reached beta), this fails.
 *
 * Warm-up: we load the pipeline first, then navigate to Path CLIENT-SIDE (via
 * the sidebar) so the in-memory profile/org cache carries over. createDeal needs
 * profile.org_id; the Path day renders before that query resolves, so a real rep
 * (whose profile is already loaded) is modeled by warming it first.
 *
 * Merchant-agnostic: it reads the merchant name off the drop-in sheet, so it
 * holds whichever seeded dealless nearby stop the running view surfaces first.
 */
test("logging a drop-in outcome creates a deal that appears on the pipeline", async ({ page }) => {
  // Warm the profile/org cache, then go to Path without a full reload.
  await page.goto("/pipeline");
  await expect(page.getByRole("heading", { name: "Pipeline", exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: "Path", exact: true }).click();

  // Open the drop-in for the current nearby stop.
  const imHere = page.getByRole("button", { name: /i'm here/i });
  await expect(imHere).toBeVisible({ timeout: 20_000 });
  await imHere.click();

  // The sheet title is "Log drop-in · {merchant}"; capture the merchant name.
  const title = page.getByText(/^Log drop-in ·/);
  await expect(title).toBeVisible();
  const merchant = (await title.innerText()).replace(/^Log drop-in ·\s*/, "").trim();
  expect(merchant.length).toBeGreaterThan(0);

  // Pick a follow-up outcome (creates a deal) and commit, asserting the deal
  // create POST actually persisted (not just that the sheet closed).
  await page.getByText("Got their statement").click();
  const dealPosted = page.waitForResponse(
    (r) => r.url().includes("/rest/v1/deals") && r.request().method() === "POST",
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: /log stop/i }).click();
  const resp = await dealPosted;
  expect(resp.ok(), `deal create POST failed: ${resp.status()}`).toBeTruthy();

  // And it really renders on the pipeline board (the name appears on the card
  // and its aria-labelled wrapper, so match the first).
  await page.getByRole("link", { name: "Pipeline", exact: true }).click();
  await expect(page.getByText(merchant, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
});
