import { test, expect } from "@playwright/test";

/**
 * Onboarding rehearsal (B1): the ISO-admin activation walk we ship in A1, end
 * to end in a real browser against a local Supabase (email confirmation off).
 *
 *   sign up (no invite) -> name workspace -> land on the /welcome invite step
 *   -> skip -> dashboard shows the count-gated Get-Started checklist
 *
 * This is the flow a brand-new buyer sees on their first visit, and the one the
 * unit tests can only verify in pieces. A unique email per run keeps it
 * repeatable without a reset between runs.
 */
test("admin sign-up flows into create-org, the invite step, and the dashboard checklist", async ({ page }) => {
  const email = `admin+${Date.now()}@e2e.navigatr.test`;

  await page.goto("/signup");
  await page.getByLabel("Full name").fill("E2E Admin");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("navigatr-e2e-123");
  await page.getByRole("button", { name: /create account/i }).click();

  // Confirmation is off locally, so signup returns a session and the app walks
  // through /auth/callback into name-your-workspace.
  await expect(page.getByLabel(/workspace name/i)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(/workspace name/i).fill("E2E Payments");
  await page.getByRole("button", { name: /create workspace/i }).click();

  // A1: the dedicated invite step, with both paths present.
  await expect(page.getByRole("button", { name: /send invites/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("Teammate email 1")).toBeVisible();
  await expect(page.getByLabel("Invite link")).toBeVisible();

  // Skipping lands on the dashboard with the count-gated checklist (0 invites,
  // 1 member -> "invite your team" still to do).
  await page.getByRole("button", { name: /skip for now/i }).click();
  await expect(page.getByText("Get started")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/invite your team/i).first()).toBeVisible();
});
