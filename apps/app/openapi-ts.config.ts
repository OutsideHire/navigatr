import { defineConfig } from "@hey-api/openapi-ts";

/**
 * Generates the typed API client from the shared OpenAPI contract.
 *
 * Source of truth: `packages/contracts/openapi.yaml` (owned by the backend
 * team; frontend regenerates on every `pnpm install` via the `postinstall`
 * script, and on demand via `pnpm generate-api`).
 *
 * Output goes to `apps/app/src/api/generated/` (gitignored at the repo root).
 *
 *   types.gen.ts   — Schemas as TypeScript interfaces/types
 *   sdk.gen.ts     — SDK class per OpenAPI tag (MeService, DealsService, …)
 *   client.gen.ts  — Pre-configured axios-backed runtime client
 *
 * Consumers import via the curated `@/api` barrel (src/api/index.ts), not
 * directly from `generated/` — that keeps a single seam to swap if the
 * generator ever changes.
 *
 * We switched from NSwag to @hey-api/openapi-ts in Session 4 to remove the
 * .NET runtime dependency from frontend dev machines. The OpenAPI spec
 * itself is unchanged — backend team still produces it via Swashbuckle.
 */
export default defineConfig({
  input: "../../packages/contracts/openapi.yaml",
  output: {
    path: "src/api/generated",
    postProcess: ["prettier"],
    clean: true,
  },
  plugins: [
    {
      name: "@hey-api/client-axios",
      // The generated client is configured at runtime from src/api/client.ts
      // (sets baseURL + interceptors). We don't use runtimeConfigPath here
      // because that creates a chicken-and-egg with the generated types.
    },
    {
      name: "@hey-api/sdk",
      // Group operations by their OpenAPI tag into classes:
      //   Me.getMe(), Deals.listDeals(), Activities.logActivity(), …
      operations: { strategy: "byTags" },
    },
    {
      name: "@hey-api/typescript",
      enums: "javascript",
    },
  ],
});
