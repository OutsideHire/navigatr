import { defineConfig } from "@playwright/test";

/**
 * Invite round-trip E2E config (regression protocol, Phase 2, golden path #4).
 *
 * Drives the REAL admin-invites -> rep-accepts flow against a LOCAL Supabase
 * (email confirmation off; the local mail server is not running, so the spec
 * reads the generated invite token straight from the DB with a service-role
 * client). Runs in CI (.github/workflows/e2e-onboarding.yml, the
 * `invite-round-trip` job), never against a deployed URL.
 *
 * Separate testDir + config from the onboarding and rep runs so no run starts
 * another's server or picks up another's specs, and so this (new, unproven)
 * spec lands as a non-blocking check rather than gating the required
 * `onboarding` job. Port 3000 matches config.toml's site_url.
 */
const PORT = 3000;
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e/invite",
  // The round-trip runs two signups + an invite + a claim, so give it room.
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
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
