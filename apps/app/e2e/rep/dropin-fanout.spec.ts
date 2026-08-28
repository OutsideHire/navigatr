import { test, expect } from "@playwright/test";

/**
 * Golden path #2: a drop-in outcome really creates a pipeline deal.
 *
 * The core value moment. The unit test for DropInSheet mocks useCreateDeal /
 * useLogActivity, so it only proves the sheet CALLS them, not that a deal
 * actually lands. This walks the whole seam against a real local Supabase:
 * open the current nearby stop, log a follow-up outcome, and confirm the deal
 * shows up on the pipeline board. If a break here closed the sheet with a
 * success toast while the deal silently never appeared (the exact class of the
 * bug that reached beta), this fails.
 *
 * Merchant-agnostic: it reads the merchant name off the drop-in sheet, so it
 * holds whichever seeded dealless nearby stop the running view surfaces first.
 */
test("logging a drop-in outcome creates a deal that appears on the pipeline", async ({ page }) => {
  await page.goto("/path");

  // Open the drop-in for the current nearby stop.
  const imHere = page.getByRole("button", { name: /i'm here/i });
  await expect(imHere).toBeVisible({ timeout: 20_000 });
  await imHere.click();

  // The sheet title is "Log drop-in · {merchant}"; capture the merchant name.
  const title = page.getByText(/^Log drop-in ·/);
  await expect(title).toBeVisible();
  const merchant = (await title.innerText()).replace(/^Log drop-in ·\s*/, "").trim();
  expect(merchant.length).toBeGreaterThan(0);

  // Pick a follow-up outcome (creates a deal) and commit.
  await page.getByText("Got their statement").click();
  await page.getByRole("button", { name: /log stop/i }).click();

  // The deal really landed: it renders on the pipeline board.
  await page.goto("/pipeline");
  await expect(page.getByText(merchant, { exact: true })).toBeVisible({ timeout: 20_000 });
});
