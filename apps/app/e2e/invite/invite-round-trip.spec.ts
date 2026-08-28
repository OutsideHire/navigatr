import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * Golden path #4: the invite round-trip (admin invites, teammate accepts).
 *
 * The core onboarding promise and the exact bug class that reached the beta.
 * The pieces are unit-tested and the RPCs have RLS tests (022/024), but nothing
 * drove the real seam end to end: admin_bulk_invite writes a token, peek_invite
 * renders the accept page, signUp + claim_invite_code link the profile, and the
 * teammate lands authenticated in the admin's org. A break anywhere here blocks
 * a whole beta org from onboarding.
 *
 * The local mail server is off, so we read the generated token straight from
 * the DB with a service-role client (bypasses RLS; org_invites is manager-only).
 * The accept leg runs in a FRESH context: /accept-invite is public but not
 * PublicOnly-gated, so a lingering admin session would claim the invite as the
 * admin and the rep signup form would never render.
 *
 * The manager-edge (reports_to) resolution is covered by supabase/tests/022; the
 * /welcome step sends no manager, so here we assert org membership + role_level.
 */
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BASE = "http://127.0.0.1:3000";

test("admin invites a teammate; the teammate accepts via the token and lands in the admin's org", async ({ page, browser }) => {
  test.skip(!SUPABASE_URL || !SERVICE_KEY, "needs local Supabase URL + service-role key (CI only)");
  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const stamp = Date.now();
  const adminEmail = `admin+${stamp}@e2e.navigatr.test`;
  const repEmail = `rep+${stamp}@e2e.navigatr.test`;
  const password = "navigatr-e2e-123";

  // --- Admin: sign up, create the org ---
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("E2E Admin");
  await page.getByLabel("Work email").fill(adminEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("checkbox", { name: /i agree to the terms/i }).click();
  await page.getByRole("button", { name: /create account/i }).click();

  await expect(page.getByLabel(/workspace name/i)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(/workspace name/i).fill("E2E Payments");
  await page.getByRole("checkbox", { name: /i agree to the terms/i }).click();
  await page.getByRole("button", { name: /create workspace/i }).click();

  // --- Admin: send an invite from the /welcome step (role_level defaults) ---
  await expect(page.getByRole("button", { name: /send invites/i })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Teammate email 1").fill(repEmail);
  await page.getByRole("button", { name: /send invites/i }).click();
  await expect(page.getByText("Get started")).toBeVisible({ timeout: 20_000 });

  // --- Read the generated token straight from the DB (service role) ---
  let token = "";
  let orgId = "";
  await expect
    .poll(
      async () => {
        const { data } = await svc
          .from("org_invites")
          .select("token, org_id")
          .eq("email", repEmail.toLowerCase())
          .is("accepted_at", null)
          .maybeSingle();
        token = data?.token ?? "";
        orgId = data?.org_id ?? "";
        return token;
      },
      { timeout: 15_000, message: "invite token should be written to org_invites" },
    )
    .toBeTruthy();
  expect(orgId, "invite should carry the admin's org id").toBeTruthy();

  // --- Rep: accept in a FRESH, unauthenticated context ---
  const repContext = await browser.newContext({ baseURL: BASE });
  const repPage = await repContext.newPage();
  await repPage.goto(`/accept-invite?token=${token}`);

  // The invited email is pre-filled + locked; fill name + password + terms.
  await expect(repPage.getByRole("button", { name: /create my account/i })).toBeVisible({ timeout: 20_000 });
  await repPage.getByLabel("Full name").fill("E2E Rep");
  await repPage.getByLabel("Password").fill(password);
  await repPage.getByRole("checkbox", { name: /i agree to the terms/i }).click();
  await repPage.getByRole("button", { name: /create my account/i }).click();

  // The teammate lands authenticated on the dashboard.
  await expect(repPage).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await repContext.close();

  // --- Assert the rep is a real active member of the admin's org ---
  const { data: repProfile } = await svc
    .from("profiles")
    .select("org_id, role_level, email")
    .eq("email", repEmail.toLowerCase())
    .maybeSingle();
  expect(repProfile, "rep profile should exist after accepting").toBeTruthy();
  expect(repProfile?.org_id, "rep should be in the admin's org").toBe(orgId);
  expect(repProfile?.role_level).toBe("sales_professional");

  // And the invite is now consumed (accepted_at stamped).
  const { data: consumed } = await svc
    .from("org_invites")
    .select("accepted_at")
    .eq("email", repEmail.toLowerCase())
    .maybeSingle();
  expect(consumed?.accepted_at, "invite should be marked accepted").toBeTruthy();
});
