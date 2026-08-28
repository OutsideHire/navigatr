import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This repo is ESM ("type": "module"), so __dirname is not defined, derive it.
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Rep golden-path E2E config (regression protocol, Phase 1).
 *
 * Drives the authenticated FIELD-REP journeys against a LOCAL Supabase seeded
 * by `supabase db reset` (supabase/seed.sql creates the dealless E2E rep
 * `repe2e@navigatr.test` and a today's Path of two dealless nearby stops). Runs
 * in CI (.github/workflows/e2e-onboarding.yml, the `rep-golden-paths` job),
 * never against a deployed URL.
 *
 * A `setup` project signs the rep in once and saves the session (storageState);
 * the `rep` project reuses it, so each spec starts already authenticated.
 *
 * Kept separate from playwright.onboarding.config.ts (which drives live signup)
 * and playwright.config.ts (the deployed smoke test) so no run starts another's
 * server or picks up another's specs. Port 3000 matches config.toml's site_url.
 */
const PORT = 3000;
const BASE = `http://127.0.0.1:${PORT}`;
const STORAGE = path.join(here, "e2e/rep/.auth/rep.json");

export default defineConfig({
  testDir: "./e2e/rep",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Path's running view reads geolocation. Grant + pin it (downtown
    // Sacramento, where the seeded prospects live) so headless Chromium never
    // blocks on a permission prompt, a known flake source for field screens.
    geolocation: { latitude: 38.5816, longitude: -121.4944 },
    permissions: ["geolocation"],
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "rep",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: STORAGE },
    },
  ],
  webServer: {
    // Vite dev reads VITE_* from the environment at startup, so the CI job
    // exports the local Supabase URL/anon key before Playwright launches this.
    command: `pnpm exec vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? "",
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? "",
    },
  },
});
