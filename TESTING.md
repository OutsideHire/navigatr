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
| **E2E** | Full app in a real browser | Use `/qa` skill for now; Playwright lands when the API is live |

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

## CI

`.github/workflows/test.yml` runs `pnpm typecheck` + `pnpm test` on every push to main and every PR. Tests must pass to merge.
