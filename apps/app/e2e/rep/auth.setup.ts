import { test as setup, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Signs in the dedicated seeded rep once and saves the session so every rep
 * spec starts authenticated. The app persists the Supabase session to
 * localStorage (key `navigatr-auth`), which Playwright's storageState captures,
 * so a real email+password sign-in here carries across the `rep` project.
 */
const STORAGE = path.join(here, ".auth", "rep.json");

setup("authenticate as the seeded rep", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("repe2e@navigatr.test");
  await page.getByLabel("Password").fill("navigatr123");
  // Exact name: a loose match would also hit "Sign in without a password".
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  // A successful sign-in lands every user on the dashboard.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

  await page.context().storageState({ path: STORAGE });
});
