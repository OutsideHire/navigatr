import { test, expect } from "@playwright/test";

/**
 * Golden path #3: moving a deal across the pipeline board.
 *
 * Drag-to-column is the PRIMARY way reps advance a deal, and it drives the
 * win-rate / weighted-pipeline numbers an ISO evaluates the product on. The
 * deal-detail dropdown path is unit-tested; the dnd-kit drag + StageUpdateModal
 * commit is untested at any level, so a drag that lands a deal in the wrong
 * stage (or silently no-ops) would corrupt pipeline reporting unnoticed.
 *
 * Logs in inline as the seeded rep1 (owns "Rivera Auto Body" in Qualified);
 * repe2e is deliberately dealless, so this spec uses its own login rather than
 * the shared storageState.
 */
test("dragging a deal to another stage column confirms and moves it", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("rep1@navigatr.test");
  await page.getByLabel("Password").fill("navigatr123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

  await page.goto("/pipeline");
  const qualified = page.getByRole("region", { name: "Qualified stage" });
  const proposal = page.getByRole("region", { name: "Proposal stage" });
  const card = qualified.getByText("Rivera Auto Body");
  await expect(card).toBeVisible({ timeout: 20_000 });

  // Manual pointer drag. dnd-kit's PointerSensor has an 8px activation distance,
  // so a one-shot dragTo won't start a drag: press, cross the threshold, move
  // into the target column in steps, settle so `over` registers, then release.
  const c = await card.boundingBox();
  const t = await proposal.boundingBox();
  if (!c || !t) throw new Error("card or target column bounding box not found");
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width / 2 + 12, c.y + c.height / 2 + 12, { steps: 6 });
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 });
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2 + 1, { steps: 2 });
  await page.mouse.up();

  // Confirm the move in the stage modal.
  await expect(page.getByText("Move Rivera Auto Body to Proposal")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Move to Proposal", exact: true }).click();

  // The card really moved: it re-renders under Proposal (only after the PATCH
  // persists and the deals list refetches) and is gone from Qualified.
  await expect(proposal.getByText("Rivera Auto Body")).toBeVisible({ timeout: 20_000 });
  await expect(qualified.getByText("Rivera Auto Body")).toHaveCount(0);
});
