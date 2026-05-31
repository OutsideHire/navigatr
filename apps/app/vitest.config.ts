/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
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
  },
});
