# @navigatr/contracts

OpenAPI source-of-truth for the navigatr API.

- `openapi.yaml` — the spec. Owned by the backend team (`apps/api`).
- The frontend (`apps/app`) regenerates a typed axios client from this file via NSwag into `apps/app/src/api/generated/` (gitignored).
- The backend validates its Swashbuckle output against this file in CI so the implementation can't drift from the contract.

When this changes:

1. Backend updates the spec (or backend regenerates via Swashbuckle and commits the new YAML).
2. Frontend runs `pnpm generate-api` to refresh `apps/app/src/api/generated/`.
3. TypeScript errors surface anywhere the frontend was depending on the old shape — fix and ship.

See `docs/contract-first-session-agenda.md` for the working agreement that produced this contract.
