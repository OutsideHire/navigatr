import { test, expect } from "@playwright/test";

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

/**
 * Service-role read via PostgREST + fetch (bypasses RLS). We deliberately avoid
 * @supabase/supabase-js here: its realtime client throws
 * "Node.js 20 detected without native WebSocket support" at createClient time.
 * A plain REST GET needs no WebSocket and no extra dependency.
 */
async function svcSelect(table: string, query: string): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`PostgREST ${table} ${res.status}: ${await res.text()}`);
  return (await res.json()) as Array<Record<string, unknown>>;
}

test("admin invites a teammate; the teammate accepts via the token and lands in the admin's org", async ({ page, browser }) => {
  test.skip(!SUPABASE_URL || !SERVICE_KEY, "needs local Supabase URL + service-role key (CI only)");

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
  // The invite RPC completes before the page navigates to the dashboard.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

  // --- Read the generated token straight from the DB (service role) ---
  const emailFilter = `email=eq.${encodeURIComponent(repEmail.toLowerCase())}`;
  let token = "";
  let orgId = "";
  await expect
    .poll(
      async () => {
        const rows = await svcSelect("org_invites", `${emailFilter}&accepted_at=is.null&select=token,org_id`);
        token = (rows[0]?.token as string) ?? "";
        orgId = (rows[0]?.org_id as string) ?? "";
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
  // The claim (via /auth/callback) can land a beat after the redirect; poll.
  let repProfile: Record<string, unknown> | undefined;
  await expect
    .poll(
      async () => {
        const rows = await svcSelect("profiles", `${emailFilter}&select=org_id,role_level,email`);
        repProfile = rows[0];
        return repProfile?.org_id ?? "";
      },
      { timeout: 15_000, message: "rep profile should exist in the admin's org after accepting" },
    )
    .toBe(orgId);
  expect(repProfile?.role_level).toBe("sales_professional");

  // And the invite is now consumed (accepted_at stamped).
  const consumed = await svcSelect("org_invites", `${emailFilter}&select=accepted_at`);
  expect(consumed[0]?.accepted_at, "invite should be marked accepted").toBeTruthy();
});
