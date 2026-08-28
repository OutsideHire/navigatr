/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // vite-plugin-pwa's `virtual:pwa-register` only exists during a real
      // build. Vitest resolves imports before `vi.mock` can intercept the
      // virtual id, so point it at a resolvable stub; tests still vi.mock it
      // to install spies.
      "virtual:pwa-register": path.resolve(
        __dirname,
        "./src/test/virtual-pwa-register-stub.ts",
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // App tests live under src. We also run the pure unit tests for the
    // Supabase Edge Function shared modules (ICP filter, geohash) — they live
    // in supabase/functions/_shared so they ship in the Deno deploy bundle,
    // but they're plain dependency-free TS, so vitest verifies them here.
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "../../supabase/functions/_shared/**/*.{test,spec}.ts",
    ],
    css: false,
    // Coverage ratchet (regression protocol, Phase 2). v8 coverage is
    // deterministic run-to-run, so these are fixed floors set just under the
    // committed baseline (statements ~77%, branches ~70%, functions ~75%,
    // lines ~78%). A change that meaningfully drops coverage fails CI; a small
    // margin tolerates incidental churn. Raise the floors as coverage improves.
    // src/lib (the money/logic dir) carries a harder floor.
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "./coverage",
      include: [
        "src/**/*.{ts,tsx}",
        "../../supabase/functions/_shared/**/*.ts",
      ],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/test/**",
        "src/**/*.d.ts",
        "src/generated/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
      ],
      thresholds: {
        statements: 76,
        branches: 69,
        functions: 74,
        lines: 77,
        "src/lib/**": {
          statements: 90,
          branches: 80,
          functions: 88,
          lines: 92,
        },
      },
    },
  },
});
