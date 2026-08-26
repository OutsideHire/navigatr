import { defineConfig } from "@playwright/test";

/**
 * Onboarding E2E config (onboarding program, B1).
 *
 * Drives the REAL create-org -> invite -> first-run flow against a LOCAL
 * Supabase where email confirmation is OFF (supabase/config.toml), so signup
 * returns a session with no inbox to check. Runs in CI (.github/workflows/
 * e2e-onboarding.yml), never against a deployed URL.
 *
 * Kept separate from playwright.config.ts (the deployed smoke test) so neither
 * run starts the other's server or picks up the other's specs. The dev server
 * is served on port 3000 to match config.toml's site_url (http://127.0.0.1:3000),
 * so the signup redirect URL is allow-listed even though confirmation is off.
 */
const PORT = 3000;
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e/onboarding",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    // Vite dev reads VITE_* from the environment at startup, so the CI job
    // exports the local Supabase URL/anon key before Playwright launches this.
    // `pnpm exec vite` (not `pnpm dev --`) so the --host/--port flags reach vite
    // directly; the `--` form gets passed through literally and vite treats it
    // as end-of-options, silently ignoring the port and serving on 5173.
    command: `pnpm exec vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Surface vite's own output so a startup crash / wrong port is visible in
    // the CI log instead of just a webServer timeout.
    stdout: "pipe",
    stderr: "pipe",
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? "",
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? "",
    },
  },
});
