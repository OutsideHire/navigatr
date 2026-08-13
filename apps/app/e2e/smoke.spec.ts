import { test, expect } from "@playwright/test";

/**
 * Post-deploy smoke test.
 *
 * Catches the failure mode a green build does not: the app deploys successfully
 * and then renders nothing. A blank white page returns HTTP 200, so anything
 * that only checks the status code reports success.
 *
 * Deliberately covers only unauthenticated surface. Signing in from CI would
 * need credentials in the workflow, and a login that breaks is caught by the
 * onboarding rehearsal instead. This asks the narrower question the promote
 * workflow actually needs answered: did we just publish a working app?
 *
 * Run against a deployed URL:
 *   SMOKE_BASE_URL=https://app.getnavigatr.io npx playwright test e2e/smoke.spec.ts
 */

const BASE = process.env.SMOKE_BASE_URL;

test.beforeAll(() => {
  if (!BASE) throw new Error("SMOKE_BASE_URL is not set");
});

test("login page loads and renders its form", async ({ page }) => {
  const response = await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  expect(response?.status(), "HTTP status").toBeLessThan(400);

  // The sign-in control is the cheapest proof that React mounted and rendered.
  // A blank page, a crashed bundle, or a missing asset all fail here while
  // still returning 200.
  await expect(page.getByRole("button", { name: /sign in/i }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("textbox", { name: /email/i }).first()).toBeVisible();
});

test("no fatal console errors on load", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();

    // Ignore noise that does not indicate a broken deploy:
    //  - third-party scripts (Sentry, Intercom) failing or being blocked
    //  - network errors for analytics beacons
    //  - browser extension chatter
    // Kept deliberately narrow. A smoke test that fails on unrelated noise
    // teaches people to override the promote gate, which is worse than not
    // having the check.
    if (/sentry|intercom|analytics|favicon|extension|third-party|net::ERR/i.test(text)) return;
    errors.push(text);
  });

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual([]);
});
