import { defineConfig } from "@playwright/test";

/**
 * Config for the post-deploy smoke test only. There is no local dev server and
 * no webServer block: these tests run against an already-deployed URL passed in
 * as SMOKE_BASE_URL, which is the whole point. Testing a locally built copy
 * would not tell us whether the deploy that just happened is serving.
 */
export default defineConfig({
  testDir: "./e2e",
  // Only the deployed smoke spec. The onboarding E2E lives under e2e/onboarding
  // and runs from playwright.onboarding.config.ts against a LOCAL stack; keeping
  // it out here stops the deployed-URL run from picking it up.
  testMatch: /smoke\.spec\.ts$/,
  timeout: 45_000,
  // A deploy can take a moment to propagate through the CDN, so one retry
  // absorbs that without masking a genuinely broken build.
  retries: 1,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
