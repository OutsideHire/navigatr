# FR-PIPE-08 Merchant Services qualification read/edit — slice 3c (2026-06-18)

Slice 3c of sub-project 3. Surfaces the merchant-services qualification (already captured at
deal creation into `deals.profession_data`) on the Deal Detail **Qualification** tab as a
real read view + an edit form. Slices 1/2/3a/3b shipped.

## Problem

The six merchant qualification fields (annual volume, acceptance methods, current processor,
current effective rate, POS/terminal, avg ticket) are written to `profession_data` (JSONB) by
`AddDealSheet`, but never read back: the frontend `Deal` type doesn't carry `profession_data`,
`useDeals` doesn't SELECT it, and the Qualification tab dumps the raw deal object as JSON. This
slice reads it back and makes it editable.

## Decisions

- **No migration** — `profession_data` JSONB already exists. Extend the read path + add an
  update path.
- **Read view** on the Qualification tab for `profession === "merchant_services"`: a labelled
  Card showing the six fields (formatted: `$` volume/ticket, `%` rate, acceptance-method chips
  via `ACCEPTANCE_METHOD_LABELS`, processor/POS text), with em-dashes for missing values. For
  non-merchant or empty `profession_data`, an empty state ("No qualification captured yet").
- **Edit** via a new `QualificationEditSheet` (Radix dialog, same shell pattern as other
  sheets) capturing the six fields, seeded from the current `profession_data`, persisting via
  `useUpdateDeal({ professionData })`. (Non-merchant professions are out of scope — only the
  merchant branch is built; payroll/treasury keep the JSON/empty view.)

## Architecture

### A. Data layer
- `mockData.ts`: add `professionData?: Record<string, unknown> | null` to the `Deal` interface;
  in `toDeal`, map `professionData: row.profession_data ?? null` (add `profession_data` to the
  `DealRow` type).
- `hooks/useDeals.ts`: add `profession_data` to the `.select(...)` column list.
- `hooks/useUpdateDeal.ts`: add `professionData?: Record<string, unknown>` to the `patch` type;
  in `toSnakeCase`, `if (patch.professionData !== undefined) out.profession_data = patch.professionData;`.

### B. `lib/merchantQualification.ts` (pure + tested)
```ts
export const ACCEPTANCE_METHOD_LABELS: Record<string, string> = {
  card_present: "Card present", card_not_present: "Card not present",
  ecommerce: "E-commerce", mobile: "Mobile", in_app: "In-app",
};
export interface MerchantQualification {
  annualVolume?: number; acceptanceMethods: string[]; currentProcessor?: string;
  currentEffectiveRate?: number; posTerminal?: string; avgTicketSize?: number;
}
/** Returns the merchant qualification when profession_data.profession === "merchant_services",
 *  else null. Defensive about missing/garbage fields. */
export function readMerchantQualification(data: Record<string, unknown> | null | undefined): MerchantQualification | null
```
Parse defensively: profession gate; numbers via `typeof === "number"`; `acceptanceMethods`
filtered to string array; strings only when non-empty.

### C. `QualificationTab` (replace the JSON dump in `DealDetailPage.tsx`)
Extract the inline `QualificationTab` into `components/QualificationTab.tsx` (props
`{ deal: Deal; onEdit: () => void }`). If `readMerchantQualification(deal.professionData)` is
non-null → render the six labelled rows (Card) + an "Edit qualification" button (→ `onEdit`).
Else → empty state Card with the Edit button (so a rep can add qualification). `DealDetailPage`
owns the sheet open state and renders `<QualificationEditSheet>`.

### D. `components/QualificationEditSheet.tsx`
Radix dialog. Props `{ open; onOpenChange; deal: Deal }`. Six controlled fields seeded from
`readMerchantQualification(deal.professionData)` on open (annual volume `$`, acceptance-method
checkboxes, processor, effective rate `%`, POS/terminal, avg ticket `$`). Save →
`useUpdateDeal().mutateAsync({ id: deal.id, patch: { professionData: { profession:
"merchant_services", annualVolume, acceptanceMethods, currentProcessor, currentEffectiveRate,
posTerminal, avgTicketSize } } })`, toast, close. Numbers parsed from text inputs; empties
omitted/undefined. Disable Save while pending.

## Data flow

`useDeals` now returns `professionData` on each deal → `useDeal` → Qualification tab reads it
via `readMerchantQualification`. Edit → `useUpdateDeal({ professionData })` → `profession_data`
column → invalidates deals → tab re-renders. No schema change.

## Error handling / edge cases

- **Non-merchant / empty profession_data:** read view shows the empty state; edit still builds
  a merchant qualification (the app's only profession in practice is merchant_services).
- **Garbage/missing fields:** `readMerchantQualification` returns safe defaults (em-dash in UI).
- **Save error:** toast; keep sheet open.
- **Double-submit:** Save disabled while `isPending`.

## Testing

- `readMerchantQualification`: merchant data → parsed fields; non-merchant profession → null;
  null/garbage → null or safe defaults; partial fields tolerated.
- `QualificationTab`: with merchant data renders the field labels + values + Edit button; with
  none renders the empty state + Edit button (no JSON dump).
- `QualificationEditSheet`: seeds from existing data; editing + Save calls `useUpdateDeal` with
  a `professionData` patch shaped `{ profession: "merchant_services", ... }`; Save disabled
  while pending.
- Data-layer: `useUpdateDeal` maps `professionData` → `profession_data` (extend its test).

## Out of scope

FR-PIPE-09 referral + migration (3d); payroll/treasury qualification views; a Figma-exact
qualification layout (none provided — PRD-driven layout); changing `AddDealSheet`'s capture.
