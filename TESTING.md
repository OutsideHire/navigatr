# Testing — navigatr frontend

100% test coverage is the key to great vibe coding. Tests let you move fast, trust your instincts, and ship with confidence. Without them, vibe coding is just yolo coding. With them, it's a superpower.

## Stack

- **Test runner:** [vitest](https://vitest.dev) 4 (Vite-native, fast)
- **DOM:** jsdom
- **Component utilities:** `@testing-library/react` + `@testing-library/user-event`
- **Assertions:** vitest globals + `@testing-library/jest-dom` matchers (`toBeInTheDocument`, `toHaveClass`, etc.)

## Run

From repo root:

```bash
pnpm --filter app test          # one-shot
pnpm --filter app test:watch    # watch mode
```

Or from `apps/app/`:

```bash
pnpm test
pnpm test:watch
```

Tests live next to the code they cover: `foo.ts` → `foo.test.ts`. The vitest config (`apps/app/vitest.config.ts`) picks up `src/**/*.{test,spec}.{ts,tsx}`.

## Layers

| Layer | What | Example |
|---|---|---|
| **Unit** | Pure functions, lib code | `src/lib/followUpScheduling.test.ts` |
| **Component** | Render a component, assert what the user sees | `src/components/navigatr/Button.test.tsx` (future) |
| **Integration** | Page-level: render with Router + Query + form state, drive interactions | `src/features/pipeline/AddDealSheet.test.tsx` (future) |
| **Database / security** | RLS + isolation, built from zero in CI | `supabase/tests/*.sql` (run by `tools/run-db-tests.sh`) |
| **E2E** | A real user's whole journey in a real browser (Playwright) against a local Supabase | `apps/app/e2e/**` (onboarding walk + the rep golden paths) |

## Conventions

- **Tests live next to source.** `foo.ts` → `foo.test.ts`. Same folder. No separate `__tests__/` directory.
- **Name what you're testing.** `describe("calculateFollowUpDate", ...)` and `it("statement_secured → +1 business day", ...)`.
- **Test behavior, not implementation.** Assert what the user sees or the value the function returns. Never `expect(x).toBeDefined()`.
- **Pin time.** Pure functions taking a `Date` argument should accept it as a param (already the case for `calculateFollowUpDate(disposition, from)`). Then tests pin `from` to a known date.
- **No secrets.** Don't import real API keys or auth tokens. Use fixtures or mock the network.

## When to write a test

- Adding a new pure function → write a unit test alongside it.
- Fixing a bug → write a regression test that fails before the fix and passes after. Comment it: `// Regression: ISSUE-NNN — {what broke}`.
- Adding error handling → write a test that triggers the error path.
- Adding a conditional → test both branches.

## Regression protocol

Full protocol: [docs/superpowers/specs/2026-08-28-regression-testing-protocol-design.md](docs/superpowers/specs/2026-08-28-regression-testing-protocol-design.md).

**Definition of done for every change.** A change is not done until all three hold:

1. **Bug-to-test rule** (the row above): every bug fix ships a test that fails before the fix and passes after; every feature ships tests for its new behavior.
2. **The layered net passes:** unit + database/security + the end-to-end golden paths.
3. **The gates allow it through:** the pipeline blocks anything that fails a required check, and every production release is confirmed live by an authenticated check.

**Golden paths** (the journeys that must never silently break) live in `apps/app/e2e`: rep opens today's Path; rep logs a drop-in that creates a deal + follow-up; rep moves a deal across the board; admin invites a rep who lands under the right manager; and one ISO can never see another's data (`supabase/tests/028_cross_org_isolation.sql`).

**Enforcement is non-blocking-first:** a new E2E or the coverage report lands as a visible-but-not-blocking check, then flips to required once it has run clean and isn't flaky.

## CI

On every PR and push to `main`:

- `test.yml`: typecheck, production build, unit tests, lint (non-blocking), coverage ratchet (enforced; floors in `apps/app/vitest.config.ts`), destructive-migration check, secrets-manifest audit.
- `database` job: builds the DB from zero and runs the RLS + cross-tenant isolation scripts.
- `e2e-onboarding.yml`: boots a local Supabase and drives the browser golden paths (admin onboarding + rep).

Required checks must pass to merge. Production promotion runs a snapshot, applies migrations + functions, deploys, smoke-tests, and tags.
