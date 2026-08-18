# Project: navigatr

## Product context

navigatr (by Navigatr LLC) is a field-sales operating system: an "action layer" on top of a rep's CRM that helps field reps discover nearby businesses, plan and run a driving route, drop in and log visits, manage a deal pipeline, book appointments and follow-ups, and route their day around calendar meetings. There is also a partner/referral side and an AI co-pilot ("Miles").

**Two audiences (build for both):**
- **Buyers = payment and payroll ISOs** (Independent Sales Organizations) who purchase navigatr for their sales teams. They care about onboarding reps, roles/permissions, and visibility into the team's pipeline (the admin / agents / dashboard surfaces).
- **End users = the ISOs' field sales reps**, working accounts in the field: in the car, on a phone, between drop-ins. They live in the discover / path / pipeline / activities screens.

**Stage & near-term goal:** pre-launch, heading into a beta. The target is landing the first **beta ISO customers**, running a 1-2 month beta, and converting them to paying. So prioritize a trustworthy, complete core experience (a rep can run their whole day; an ISO can onboard a team) over breadth. Avoid half-built features that would erode beta trust. (Pre-launch gates and current initiative status live in Claude memory, not here.)

**Tone / design personality (hold both at once):**
- **Fast and no-nonsense for reps in the field** — mobile-first, minimal taps, legible and quick while moving.
- **Polished and premium** — looks like a paid product an ISO would confidently put in front of its team.
- When they tension: reps' speed wins on the in-field screens (discover, path, quick-log); premium polish wins on the surfaces buyers evaluate (marketing, settings, dashboards, onboarding).

**Non-goals:** none stated yet (revisit as scope firms up).

## Design system source of truth

`/Users/ryanmeo/Downloads/DESIGN.md` is the design system reference for this project. Read it before any Figma work. Do not work from memory.

The active Figma file is **navigatr v1** (`fileKey: ti9rBqqWjTro9jIwLaCmVN`). Use the Figma Remote MCP namespace (`mcp__c564a1a7-db32-496f-ba98-4f0c23a1678f__use_figma`), not local Dev Mode.

## Figma MCP — how to get data back from `use_figma`

The `use_figma` tool's plugin runtime discards `return` and `console.log`. To surface data, end the JS payload with `throw new Error("OUT::" + JSON.stringify(result))` and parse the rejected error message: take everything after `OUT::` up to the first `\n    at ` (Figma's stack-trace prefix), then `JSON.parse`. If the message has no `OUT::` marker it's a real error — surface it.

**Single source of truth: `tools/figma-mcp-helper.ts`.** Read it before any Figma-fidelity session. It carries the canonical marker, the wrap template, and a parser. Don't reinvent the pattern inline; if `use_figma` ever starts surfacing return values, retire the helper in one place.

## Mandatory: post-build audit before declaring Figma work done

**Before reporting any Figma build pass as complete**, run the canonical post-build audit from DESIGN.md (the runnable JS block under "Canonical post-build audit"). It checks six bug classes file-wide:

1. Page-level overlaps
2. Alpha-baked paint.opacity ≠ variable.alpha
3. KPI row child height mismatches
4. Pill avatars (w ≠ h)
5. 1px-collapsed wrap-grid items
6. Generic content overflow

Expected output:
```json
{"pageOverlaps":0,"alphaMismatches":0,"kpiHeightMismatches":0,"pillAvatars":0,"collapsedFrames":0,"overflows":0}
```

Anything non-zero: stop, fix, re-run. Do not report DONE until all six are zero. Do not report DONE_WITH_CONCERNS as a substitute for fixing — every recurring bug class in this project's history was a result of stopping at "concerns" instead of running the audit.

## Recurring bug classes (read DESIGN.md anti-patterns 1, 11, 15-22 before each session)

These keep coming back in fresh code if not actively guarded against:
- Alpha-baked tints rendering solid (Figma drops `color.a` from bound paints — must set `paint.opacity = variable.alpha`)
- Sidebar active fill stamped at wrong opacity on fresh instances
- Vector paths positioned at (0,0) when SVG data uses absolute coords
- HUG cards in a row producing uneven heights when content varies
- WRAP grids silently collapsing to fewer columns when `tileW × cols + gap` exceeds parent width
- Hardcoded Y positions on master frames drifting when other frames grow

The fix patterns for each are in DESIGN.md. The audit catches the symptoms.

## Testing

Frontend tests run via vitest from `apps/app/`. See `TESTING.md` for the full guide.

```bash
pnpm --filter app test          # one-shot
pnpm --filter app test:watch    # watch mode
```

Tests live next to source (`foo.ts` → `foo.test.ts`). Goals:

- 100% coverage is the goal. Tests make vibe coding safe.
- Write a test for every new function.
- Fix a bug → write a regression test that fails before the fix and passes after.
- Add a conditional → test both branches.
- Add error handling → test the error path.
- Never commit code that breaks existing tests.

CI: `.github/workflows/test.yml` runs typecheck + tests on every push to main and every PR.

## Shipping and environments (follow always)

navigatr ships on a two-branch pipeline. Full detail is in the `ship-navigatr`
skill; the always-on rules:

- Flow: feature branch -> PR -> merge to `main` (auto-deploys STAGING at
  staging.getnavigatr.io) -> `promote-production` workflow -> `release`
  (PRODUCTION at app.getnavigatr.io). `main` is STAGING, not production.
- NEVER push straight to `main` expecting it to reach customers, and NEVER
  hand-apply SQL to the production database. Migrations and edge functions ship
  through the pipeline (`supabase db push` / `functions deploy` run by CI).
- Production changes (the `release` branch, the prod Supabase project
  `ogvcveimjjeywfdkkinb`) happen ONLY via the approved `promote-production`
  workflow, and only on the user's explicit go.
- Staging Supabase = `hjhxdznpdytnafsxvptx` (all mock flags ON). Production =
  `ogvcveimjjeywfdkkinb`. Verify with tests + a real `pnpm build` before merging.
