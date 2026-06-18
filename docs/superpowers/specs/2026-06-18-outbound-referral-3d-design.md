# FR-PIPE-09 outbound referral — slice 3d (2026-06-18)

Final slice of sub-project 3. Lets a rep send a deal as a referral **to** a partner from the
Deal Detail "Send as referral" quick action. Slices 1/2/3a/3b/3c shipped.

## Problem

`partner_deals` records only **inbound** attribution (a partner referred a deal *to us*, via
`useAttributeDeal`). There is no way to send a deal *out* to a partner. The Quick-actions
"Send as referral" is currently a disabled stub.

## Decisions (locked in brainstorming)

- **Add a `direction` flag to `partner_deals`** (`inbound` | `outbound`), default `inbound` so
  existing rows are unchanged. Record-only — **no partner notification** (out of scope).
- "Send as referral" opens a sheet to pick a partner + optional notes, and records an
  **outbound** `partner_deals` row.
- Keep inbound attribution semantics intact: the partners list's `attributedDealIds`
  (inbound referrals partners sent us) must **exclude** outbound rows.

## Architecture

### A. Migration `supabase/migrations/20260618000001_partner_deal_direction.sql`
```sql
alter table partner_deals
  add column if not exists direction text not null default 'inbound'
  check (direction in ('inbound', 'outbound'));
```
Idempotent column add; default keeps every existing link inbound. **Hand-applied** to the
linked project (like the voice-notes migration) — the outbound insert references this column,
so the migration must be applied for the feature to function in prod. PK stays
`(partner_id, deal_id)`; a given deal↔partner pair is unique across directions (acceptable for
MVP — outbound referrals normally go to a partner not already linked).

### B. `hooks/useReferDeal.ts` (new)
Mirror `useAttributeDeal` but insert `direction: "outbound"`:
`mutationFn({ partnerId, dealId, notes? })` → `supabase.from("partner_deals").insert({ org_id,
partner_id, deal_id, attributed_by: userId, notes: notes ?? "", direction: "outbound" })`;
`onSuccess` invalidate `PARTNERS_QUERY_KEY(userId)`. Same guards (signed in + org loaded).

### C. `hooks/usePartners.ts` (filter inbound for attribution)
The embed `partner_deals(deal_id)` currently counts all links as `attributedDealIds`. Change
the embed to `partner_deals(deal_id, direction)` and, in the row mapper, build
`attributedDealIds` from only rows where `direction !== "outbound"` (treat missing/`inbound` as
inbound). This keeps outbound referrals from inflating inbound attribution counts.

### D. `components/SendReferralSheet.tsx` (new)
Radix dialog (mirror `StageUpdateModal` shell). Props `{ open; onOpenChange; deal: Deal }`.
Body: a partner picker (from `usePartners()` — a `Select` of partner `name · company`, or a
simple list) + an optional notes `NotesFieldWithMic`/textarea. Footer Cancel + "Send referral"
(disabled until a partner is chosen / while pending). Save → `useReferDeal().mutateAsync({
dealId: deal.id, partnerId, notes })`, toast "Referred {deal.companyName} to {partner.name}",
close. Error → toast, keep open. Empty partners list → show "No partners yet — add one in
Partners" and disable send.

### E. `pages/DealDetailPage.tsx` wiring
Add `const [referralOpen, setReferralOpen] = React.useState(false)`. Pass
`onSendReferral={() => setReferralOpen(true)}` to `<QuickActionsCard>` (the prop already
exists from slice 3a). Render `<SendReferralSheet open={referralOpen}
onOpenChange={setReferralOpen} deal={deal} />` near the other page-level sheets. "Send as
referral" is now enabled.

## Data flow

Quick action → SendReferralSheet → `useReferDeal` inserts an outbound `partner_deals` row →
invalidates partners. The partner's detail still shows only inbound deals in
`attributedDealIds` (filtered). No change to deals/qualification/stage flows.

## Error handling / edge cases

- **No partners:** sheet shows the empty hint; send disabled.
- **Duplicate (partner, deal) pair:** PK conflict → the insert errors → toast; rep can pick a
  different partner. (Rare; documented limitation of keeping the existing PK.)
- **Not signed in / org not loaded:** mutation throws (same guard as `useAttributeDeal`).
- **Save error:** toast, keep sheet open.
- **Migration not yet applied:** the outbound insert fails (unknown column) → toast; ship the
  migration with this slice and apply it before relying on the feature.

## Testing

- `useReferDeal`: inserts with `direction: "outbound"` + the right partner/deal/org/notes;
  invalidates partners (mock supabase like the existing partner-hook tests).
- `usePartners` mapper: a partner with an outbound `partner_deals` row does NOT include that
  deal id in `attributedDealIds`; inbound rows still do.
- `SendReferralSheet`: lists partners; send disabled until one is selected; selecting +
  Send calls `useReferDeal` with `{ dealId, partnerId }`; empty-partners shows the hint.
- `DealDetailPage`: "Send as referral" quick action is enabled and opens the sheet (or rely on
  the QuickActionsCard handler unit test + the sheet test).

## Out of scope

Partner notifications/email; a `direction`-aware PK (kept the existing composite PK);
surfacing outbound referrals on the partner detail page (a future "deals we sent them"
section); credit-share. The migration is hand-applied (documented), not auto-run by deploy.
