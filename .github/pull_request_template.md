<!--
Regression protocol: docs/superpowers/specs/2026-08-28-regression-testing-protocol-design.md
Keep the description tight. The checklist is the "definition of done".
-->

## What and why

<!-- One or two sentences: what changes, and why. -->

## Testing checklist

- [ ] **Bug fix?** Added a regression test that FAILS before the fix and PASSES after (comment it with what broke).
- [ ] **New behavior?** Covered with unit/component tests; both branches of any new conditional and the error path.
- [ ] **Touches data access / a new table or policy?** Added or updated a `supabase/tests/*.sql` isolation test (an ISO must never see another ISO's data).
- [ ] **Touches a golden-path journey** (Path, drop-in, pipeline board, invite/onboarding)? Confirmed the relevant `apps/app/e2e` spec still passes, or added one.
- [ ] `pnpm --filter app test`, `pnpm exec tsc -b`, and `pnpm build` are green locally.

## Notes

<!-- Migrations, mock-flag changes, follow-ups, or anything a reviewer should know. -->
