# Outbound referrals on the Partner detail page (2026-06-18)

Surfaces OUTBOUND referrals ("deals we referred TO this partner") on the Partner detail page.
Outbound links are already recorded (`partner_deals.direction = 'outbound'` via `useReferDeal`),
and `direction` already exists in prod — this is a **display + management** feature, **no DB
change**. Today the page shows only inbound referrals.

## Decisions (approved in brainstorming)

- **Full parity:** the new outbound section displays the deals we referred to the partner, with
  **add** ("Refer a deal" → `useReferDeal`) and **remove** (`useUnattributeDeal`).
- **Extract a shared `ReferralSection`** from the current inline inbound UI and render it twice
  (inbound + outbound).
- **Labels:** inbound section renamed "Referrals" → **"Referred to us"**; new outbound section
  **"Referred to them"**.
- **Partner KPIs stay inbound-only** (revenue + deal count keep using `attributedDealIds`) —
  outbound deals are ones *we* sent *them*, not revenue they generated.
- **Out of scope:** partner notification (no notification infra), credit-share.

## Architecture

### A. `usePartners` mapper + `Partner` type
The query already embeds `partner_deals(deal_id, direction)`. The mapper builds
`attributedDealIds` (inbound). Add a sibling `outboundDealIds`:
```ts
const links = row.partner_deals ?? [];
// in the returned Partner:
attributedDealIds: links.filter((l) => l.direction !== "outbound").map((l) => l.deal_id),
outboundDealIds:   links.filter((l) => l.direction === "outbound").map((l) => l.deal_id),
```
Add `outboundDealIds: string[]` to the `Partner` type in `features/partners/mockData.ts` (update
any mock partner fixtures to include it — default `[]`). `usePartner` returns `Partner` from
`usePartners`, so it inherits the field with no change.

### B. New `components/ReferralSection.tsx`
Extract the current inline inbound "Referrals" section (picking state + Select picker + deal
rows linking to `/pipeline/:dealId` + remove) into a reusable component:
```ts
interface ReferralSectionProps {
  title: string;                               // "Referred to us" | "Referred to them"
  deals: Deal[];                               // resolved deal objects for this direction
  eligibleOptions: Array<{ value: string; label: string }>;  // deals addable here
  addLabel: string;                            // "Attach deal" | "Refer a deal"
  onAdd: (dealId: string) => void | Promise<void>;
  onRemove: (dealId: string) => void | Promise<void>;
  emptyText?: string;
}
```
Owns its own `picking`/`pickedDealId` local state, the toast on add/remove failure, and the row
rendering (company + value, link to the deal, remove button). No data fetching inside — the page
passes deals/options/handlers.

### C. `PartnerDetailPage` wiring
- Derive both deal lists from `allDeals` (`useDeals`) cross-referenced with the partner's id lists
  (mirror the existing `deals` memo):
  - `inboundDeals` = `partner.attributedDealIds` × allDeals.
  - `outboundDeals` = `partner.outboundDealIds` × allDeals.
- **Eligible** for *either* picker = `allDeals` minus deals already linked to this partner in
  **either** direction (`attributedDealIds ∪ outboundDealIds`), since the `(partner_id, deal_id)`
  PK allows only one link per pair.
- Render `<ReferralSection>` twice:
  - Inbound: `title="Referred to us"`, `deals={inboundDeals}`, `addLabel="Attach deal"`,
    `onAdd` → `useAttributeDeal().mutateAsync({ partnerId, dealId })`,
    `onRemove` → `useUnattributeDeal().mutateAsync({ partnerId, dealId })`.
  - Outbound: `title="Referred to them"`, `deals={outboundDeals}`, `addLabel="Refer a deal"`,
    `onAdd` → `useReferDeal().mutateAsync({ partnerId, dealId })`,
    `onRemove` → `useUnattributeDeal().mutateAsync({ partnerId, dealId })`.
- Keep the partner KPIs (revenue, deal count) computed from `inboundDeals` only — unchanged.

## Data flow

`usePartner` → `partner.{attributedDealIds, outboundDealIds}`; `useDeals` → `allDeals`. The page
resolves both lists + the shared eligible set, and hands them to the two `ReferralSection`s. Add/
remove mutate `partner_deals` and invalidate the partners query (existing hook behavior), which
refetches the embed and rebuilds both id lists.

## Error handling / edge cases

- **Add failure / remove failure** → toast (in `ReferralSection`); list stays until the
  invalidation refetch resolves.
- **Empty** → each section shows its `emptyText`.
- **A deal already linked in either direction** is excluded from both pickers (PK uniqueness).
- **Deleted/missing deal id** (link to a deal not in `allDeals`) → filtered out (mirror the
  existing `.filter(Boolean)` in the current `deals` memo).
- **Unlink is direction-agnostic** (`useUnattributeDeal` deletes by `(partner_id, deal_id)`), which
  is correct — a pair has exactly one row/direction.

## Testing

- `usePartners` mapper: a partner with mixed links splits into `attributedDealIds` (inbound) and
  `outboundDealIds` (outbound) correctly; `direction` absent → treated as inbound.
- `ReferralSection`: renders the passed deals (+ links), the empty state, the picker from
  `eligibleOptions`; selecting + add fires `onAdd(dealId)`; remove fires `onRemove(dealId)`.
- `PartnerDetailPage`: renders both "Referred to us" and "Referred to them" with the right deals;
  outbound add calls `useReferDeal`; remove calls `useUnattributeDeal`; the eligible picker
  excludes deals already linked in either direction; KPIs reflect inbound only.

## Out of scope

Partner notification; credit-share/revenue-split; changing how outbound referrals are created from
the deal side (the deal-side quick action stays); any schema/migration change.
