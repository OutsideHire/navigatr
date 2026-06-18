# Pipeline List view redesign (2026-06-18)

Sub-project 1 of 3 in the Pipeline redesign (List → Kanban → Deal Detail). Figma:
`navigatr v1`, desktop List frame `325:4`, mobile List frame `324:9` (parent `324:2`).

## Problem

The Pipeline list screen (`PipelinePage`) works and carries the right data, but its
deal card, KPI strip, and header diverge from the new Figma design. This brings the
**List view** to fidelity with the Figma. Kanban and Deal Detail are separate sub-projects.
Functional PRD gaps (stage-update modal, Merchant Services qualification, outbound
referral) are out of scope here — they land with the Deal Detail sub-project.

## Decisions (locked in brainstorming)

- **Follow the Figma faithfully** for all visual elements, with one approved enrichment
  (the footer, below). Preserve all existing non-visual behavior.
- **Footer = hybrid** (recommended + approved): `Last activity: {date}` ↔
  `Next: {verb} · {date}`, where `{verb}` is the existing `STAGE_NEXT_VERB[stage]`. This
  matches the Figma layout/labels but enriches the right side with the next-step verb.
  No follow-up date → `Next: {verb}` (verb only).
- The Figma deal card **omits industry and lead source** (FR-PIPE-02 lists them); we follow
  the Figma — they are not shown on the card. (Revisit in a later sub-project if needed.)

## Architecture

### A. New component `components/DealCard.tsx`
Extract the deal card out of `PipelinePage` into its own file (it is the bulk of the rework
and warrants isolated tests). Props: `{ deal: Deal }`. It owns navigation to
`/pipeline/:id` and stops propagation on inner interactive elements (call button, email
link) so those don't trigger the card's drill-in.

Card anatomy (matches Figma `324:63` / desktop equivalent):
- Wrapper: `CardWithStatusBand` with `bandColor={STAGE_BAND_COLOR[deal.stage]}` (keep the
  4px left band), `onClick` → `navigate(/pipeline/${deal.id})`, `contentPadding="md"`.
- **Top row:** company name (`text-body-strong`, truncate) on the left; right column holds
  the value (`text-heading-sm tabular-nums`) with a **stage pill** beneath it. The pill is a
  small rounded-full chip, stage-colored (soft background + readable text), label
  `STAGE_LABEL[deal.stage]`.
- **Contact name** (`text-body-sm text-text-muted`, truncate) directly under the company.
- **Contact row:** `PhoneWithClickToCall` (`phoneNumber={deal.phone}`, `size="sm"`) for the
  formatted number + call icon-button, followed by an **email** link: mail icon +
  `<a href={"mailto:" + deal.email}>` (truncate, `text-text-muted`, hover underline). Both
  call `e.stopPropagation()` so they don't drill into the card.
- **Probability:** caption `PROBABILITY · {deal.probability}%` above a **progress bar** — a
  `surface-sunken` track with a stage-colored fill at `width: {probability}%`. Fill color
  reuses the stage palette (e.g. `STAGE_BAND_COLOR` → matching bg class). `role="progressbar"`
  with `aria-valuenow={probability}`, `aria-valuemin={0}`, `aria-valuemax={100}`.
- **Footer (hybrid):** hairline top border; left `Last activity: {formatRelative or
  formatShortDate(lastActivity)}`; right `Next: {STAGE_NEXT_VERB[stage]}` plus
  `· {formatShortDate(nextFollowup)}` when `nextFollowup` is set.

### B. `PipelinePage.tsx` changes
- **List layout:** desktop renders cards in a **2-column grid** (`grid grid-cols-1
  md:grid-cols-2 gap-3`) in both the list view and the kanban-fallback-below-lg path.
  Mobile stays single column.
- **Header subhead:** replace the static `HEADER_SUBHEAD` with a computed
  `{activeDeals} active deals · {weightedFormatted} weighted`, derived from the same KPI
  computation already in `KpiStrip` (lift the active-deal count + weighted sum so the
  subhead and KPI strip share one source). Keep search, Add deal, Filter, Sort, view toggle.
- **KPI strip restyle:** keep the four KPIs and their computation
  (Total pipeline / Weighted / Active deals / Won this month). Restyle each card to the
  Figma: a small stage/accent **colored dot** + uppercase eyebrow + large value
  (`text-heading-lg tabular-nums`), dropping the subtitle line. Implement by adjusting the
  existing `KpiStrip` render (use a simple card matching Figma rather than the
  subtitle-bearing `KpiCard`, if `KpiCard` can't render dot-only; prefer reusing tokens, no
  new primitive).
- Replace the inline `DealCard` definition with an import of the new `components/DealCard`.
  Remove the now-unused inline `ProbabilityDots` and `formatPhoneForDisplay` (the card uses
  `PhoneWithClickToCall`, which formats internally).

### C. Stage pill + bar colors
The stage→color mapping already exists (`STAGE_BAND_COLOR`, and `KanbanBoard`'s
`STAGE_DOT_CLASS`: new=info, contacted=warning, qualified=teal, proposal=violet,
won=success). Reuse a single mapping for the band, the pill background, and the probability
bar fill so a card is mono-stage-colored. If a shared map doesn't already live in
`mockData`, add a small `STAGE_TONE` helper there (bg + text classes per stage) rather than
duplicating class strings across components.

## Data flow

`useDeals()` (unchanged) → `PipelinePage` filters (stage chip, search, owner) → maps to
`DealCard`. `Deal` already exposes `email` (mapped from `contact_email`), `phone`,
`probability`, `stage`, `valueCents`, `contactName`, `companyName`, `lastActivity`,
`nextFollowup`. No hook/schema/query change.

## Error handling / edge cases

- **Missing email:** render the phone/call button only; omit the email link when
  `deal.email` is empty.
- **No next follow-up:** footer shows `Next: {verb}` with no date (mirrors Figma `Next: —`).
- **probability 0 / 100:** bar renders at 0% (empty track) / full; aria values reflect it.
- **Long company/contact/email:** truncate with `min-w-0` + `truncate` so the 2-col grid
  cells don't overflow.
- **Empty / loading / owner-filtered:** existing `EmptyState`, `LoadingList`, and owner
  banner are unchanged.

## Testing

**New `components/DealCard.test.tsx`:**
- Renders company, formatted value, stage pill (`STAGE_LABEL`), contact name, email link
  (`mailto:`), and the probability bar with correct `aria-valuenow`.
- Footer shows `Next: {verb}` and includes the date when `nextFollowup` is set; verb-only
  when not.
- Clicking the card navigates to `/pipeline/:id`; clicking the email/call does NOT navigate
  (stopPropagation) — assert `navigate` not called on inner-link click.
- No email → no mailto link rendered.

**Update `PipelinePage` tests (or add):**
- Header subhead shows computed `{N} active deals · {$weighted} weighted`.
- Desktop list uses a 2-column grid container (assert the grid class / both cards present).
- KPI strip still renders the four computed values.
- Existing filter/search/empty/view-toggle/owner-banner tests stay green.

## Out of scope

Kanban redesign (sub-project 2); Deal Detail + FR-PIPE-07/08/09 (sub-project 3); advanced
Filter and Sort (still Sprint-2 stubs); industry/source on the card; any server/query change.
