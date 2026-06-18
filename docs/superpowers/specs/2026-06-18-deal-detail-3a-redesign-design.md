# Deal Detail redesign — slice 3a (visual) (2026-06-18)

Slice 3a of sub-project 3 (Deal Detail). Figma: `navigatr v1` desktop Detail `328:4`, mobile
`327:6`. Pure visual/structural redesign — the functional gaps land in later slices:
3b (FR-PIPE-07 stage modal + Kanban DnD), 3c (FR-PIPE-08 qualification), 3d (FR-PIPE-09
referral).

## Problem

`DealDetailPage` renders the right pieces (hero, 5 tabs, overview cards, activity timeline)
but in a single stacked column. The Figma is a **2-column desktop layout** with a persistent
right rail (Latest activity, Quick actions, Related). This slice restructures to that layout
and adds the two new right-rail cards as a shell — without building the not-yet-existing
behaviors behind them.

## Decisions (locked in brainstorming)

- **2-column desktop layout** (`lg`): left = hero is full-width on top, then below it the
  tabs + tab content on the left, the right rail on the right. Mobile = single column
  (hero → tabs/content → right-rail cards stacked).
- **Latest activity moves to the right rail** (out of the Overview tab) and shows up to **3**
  recent activities (current shows 1 in-tab).
- **Quick actions card (new):** four rows per Figma — *Send to CRM*, *Send as referral*,
  *Schedule appointment*, *Mark as lost*. In 3a these are the visual shell:
  - Send to CRM → disabled, "Coming soon" (no CRM integration exists).
  - Send as referral → disabled, "Coming soon" (wired in slice 3d).
  - Schedule appointment → disabled, "Coming soon" (no scheduler exists).
  - Mark as lost → disabled in 3a, "Coming soon"; wired in slice 3b when stage changes are
    centralized into the FR-PIPE-07 modal. (The hero stage picker still sets Lost in the
    meantime, so no functionality is removed.)
- **Related card (new):** show the deal's **other deals for the same company** (computed from
  `useDeals`, excluding the current deal — links to `/pipeline?…`/the deal), plus a static
  "playbook" row rendered disabled/"Coming soon". A referrer row is shown only if a source
  partner is readily available; otherwise omitted (no fabricated data).
- **Hero, tabs, stage picker, Edit, Log activity, activity timeline, qualification JSON tab**
  are unchanged in 3a (qualification gets its real view in 3c).

## Architecture

### A. `DealDetailPage.tsx` layout
- Keep the back link + `HeroCard` full-width at top (inside `max-w` container).
- Below the hero, wrap in a 2-col grid at `lg`: `grid grid-cols-1 gap-4 lg:grid-cols-3
  lg:gap-6`. Left = `lg:col-span-2` holds the `Tabs.Root` (TabBar + all Tabs.Content). Right
  rail = `lg:col-span-1` holds `<LatestActivityCard>`, `<QuickActionsCard>`, `<RelatedCard>`
  stacked (`flex flex-col gap-4`). On mobile the grid collapses to one column; the right rail
  naturally stacks under the tabs.
- **Remove** `<LatestActivityCard>` from the Overview `Tabs.Content` (it now lives in the
  right rail, always visible). Overview tab keeps ContactInfoCard + SourceCard +
  PipelineProgressionCard.

### B. `LatestActivityCard` — show up to 3
- Change its prop from `activity: Activity | undefined` to `activities: Activity[]` and render
  up to the first 3 (`activities.slice(0, 3)`), each a compact row (icon + type · duration ·
  disposition, outcome notes, relative time) reusing the existing row markup. Keep the
  "View all →" affordance (→ `onViewAll`, flips to the Activity tab) and the empty state when
  there are none. Caller passes `activities` (already loaded via `useActivities`).

### C. New `components/QuickActionsCard.tsx`
Presentational card titled "Quick actions". Props:
`{ onMarkLost?: () => void }` (only the wired action takes a handler; the rest are static
stubs in 3a). Renders four full-width secondary buttons in order: Send to CRM (disabled),
Send as referral (disabled), Schedule appointment (disabled), Mark as lost (disabled in 3a —
no handler passed yet; styled as the destructive/red text row per Figma but inert). Disabled
buttons show a "Coming soon" affordance (e.g. `title`/muted styling). Keep it dependency-free
so later slices flip individual actions live by passing handlers.

### D. New `components/RelatedCard.tsx`
Props: `{ deal: Deal }`. Uses `useDeals()` to find other deals with the same `companyName`
(excluding `deal.id`); if any, render a row "{company}'s other deals ({n})" → navigates to
the pipeline (or first other deal). Always render a static, disabled "Manufacturing playbook
· Resource" style row ("Coming soon"). Title "Related". If there are no other deals and no
referrer, still render the card with just the playbook stub (matches Figma's persistent
card), or render nothing — prefer rendering the card with the playbook row for layout
stability.

## Data flow

`useDeal(dealId)` + `useActivities(dealId)` (unchanged). `RelatedCard` additionally reads
`useDeals()` (shared cache, no new fetch) to compute same-company deals. No schema/mutation
change in 3a.

## Error handling / edge cases

- **No activities:** LatestActivityCard shows its existing empty state.
- **No other-company deals:** RelatedCard shows only the playbook stub row.
- **Mobile:** 2-col grid collapses to 1; right-rail cards stack below the tab content.
- Disabled Quick-actions are non-interactive (`disabled` + `aria-disabled`), no handlers.

## Testing

**`DealDetailPage` (regression test exists — keep green):** add/adjust a test asserting the
right rail renders Quick actions ("Send as referral" present) and that Latest activity is
outside the Overview tab (visible regardless of active tab). Keep the existing not-found +
hero tests green.

**`QuickActionsCard.test.tsx` (new):** renders the four labelled actions; Send to CRM / Send
as referral / Schedule appointment are disabled; with no `onMarkLost`, Mark as lost is
disabled.

**`RelatedCard.test.tsx` (new):** given mock deals with two same-company deals, renders
"{company}'s other deals (1)"; with none, renders only the playbook row and does not crash.

## Out of scope

FR-PIPE-07 stage modal + Kanban DnD (3b); FR-PIPE-08 qualification read/edit (3c);
FR-PIPE-09 referral + the partner_deals migration (3d); a real CRM integration; appointment
scheduling; a playbook/resources system; the mobile pixel-exact spacing beyond the
single-column stack.
