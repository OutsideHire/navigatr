# Type-Specific Activity Outcomes — Design

**Goal:** Show Drop-in activities a field-visit outcome set, distinct from the call outcomes shown for
Call/Appointment/Email — so a drop-in is dispositioned with relevant options.

## Problem

`LogActivitySheet` and `EditActivitySheet` each present a single, call-centric disposition list
(`statement_secured`, `positive_engagement`, `connected_with_dm`, `dm_unavailable`, …) for **every**
activity type. A Drop-in (a physical visit) is offered call outcomes like "DM Unavailable" / "Connected
with DM," which don't fit.

The data model already supports the fix: the `Disposition` enum + `DISPOSITIONS` specs already include
field-visit outcomes (`met_dm`, `gatekeeper`, `left_collateral`, `not_in_office`, `scheduled_callback`,
`closed_locked`, `do_not_contact`, `out_of_business`, `other`), and the Postgres `disposition` enum type
already accepts them (migration `20260601000002_path_dropin.sql`). They're just never surfaced when
logging a Drop-in. No migration needed — frontend only.

## Design

### `src/features/activities/lib/dispositionSets.ts` (new)
Single source of truth for which outcomes each activity type offers.

```ts
import type { ActivityType } from "../mockData";
import type { Disposition } from "@/lib/followUpScheduling";

const CALL_TOP: Disposition[] = ["statement_secured", "positive_engagement", "dm_unavailable", "not_interested"];
const CALL_ALL: Disposition[] = ["statement_secured", "positive_engagement", "connected_with_dm",
  "dm_unavailable", "followup_requested", "future_potential", "low_probability", "not_interested",
  "wrong_number", "closed_lost"];
const DROPIN_TOP: Disposition[] = ["met_dm", "gatekeeper", "left_collateral", "not_in_office"];
const DROPIN_ALL: Disposition[] = ["met_dm", "gatekeeper", "left_collateral", "not_in_office",
  "scheduled_callback", "closed_locked", "do_not_contact", "out_of_business", "other"];

export interface DispositionSet { top: Disposition[]; all: Disposition[]; }

export const DISPOSITIONS_BY_TYPE: Record<ActivityType, DispositionSet> = {
  call: { top: CALL_TOP, all: CALL_ALL },
  appointment: { top: CALL_TOP, all: CALL_ALL },
  email: { top: CALL_TOP, all: CALL_ALL },
  drop_in: { top: DROPIN_TOP, all: DROPIN_ALL },
};

// Every selectable value across all types — the zod enum source (as const for z.enum).
export const DISPOSITION_VALUES = [
  "statement_secured", "positive_engagement", "connected_with_dm", "dm_unavailable",
  "followup_requested", "future_potential", "low_probability", "not_interested",
  "wrong_number", "closed_lost",
  "met_dm", "gatekeeper", "left_collateral", "not_in_office", "scheduled_callback",
  "closed_locked", "do_not_contact", "out_of_business", "other",
] as const;
```

### `LogActivitySheet.tsx`
- Replace the local `TOP_DISPOSITIONS` / `ALL_DISPOSITIONS` / `DISPOSITION_ENUM` with the shared module.
- Disposition grid: `const set = DISPOSITIONS_BY_TYPE[type]; (showAll ? set.all : set.top).map(...)`.
- "Show all" label uses `set.all.length` (drop-in has 9, call has 10).
- zod schemas use `z.enum(DISPOSITION_VALUES)` so any type's value validates.

### `EditActivitySheet.tsx`
- Same shared lists, keyed by `activity.type`.
- **Legacy guard:** if `activity.disposition` isn't in the type's `top`, start expanded (mirrors the
  existing behavior). If it isn't in `all` either (legacy cross-type value), prepend it to the displayed
  list so the rep always sees + can keep their current outcome.

## Testing

- `dispositionSets.test.ts` — every `ActivityType` has non-empty `top`/`all`; `top ⊆ all`; the call and
  drop-in sets are disjoint enough that drop-in includes `met_dm` and excludes `connected_with_dm` (the
  differentiation contract); `DISPOSITION_VALUES` is a superset of every type's `all`.
- `LogActivitySheet` test — selecting type Drop-in shows "Met with decision maker" and not "Connected with
  DM"; selecting Call shows "Connected with DM" (under show-all) and not "Met with decision maker".
- `EditActivitySheet` test — editing a drop-in activity shows the drop-in set; a legacy call-disposition on
  a drop-in activity still renders selected.

## Risks

- Pure frontend; no migration. Existing activities are unaffected (their stored disposition still resolves
  via `DISPOSITIONS`). The legacy guard prevents the edit sheet from ever hiding a stored value.
