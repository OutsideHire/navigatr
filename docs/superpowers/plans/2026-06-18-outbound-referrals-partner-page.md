# Outbound referrals on the Partner detail page — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Show + manage OUTBOUND referrals ("deals we referred to this partner") on the Partner detail page, alongside the existing inbound ones, via a shared `ReferralSection`. No DB change (`partner_deals.direction` already exists in prod).

**Spec:** `/Users/ryanmeo/navigatr/docs/superpowers/specs/2026-06-18-outbound-referrals-partner-page-design.md`

Run pnpm from `/Users/ryanmeo/navigatr/.claude/worktrees/outbound-referrals/apps/app` (worktree-local `pnpm typecheck`/`pnpm test <pattern>`).

**Reference (read):** `features/partners/hooks/usePartners.ts` (mapper), `features/partners/mockData.ts` (Partner type + mock fixtures), `features/partners/pages/PartnerDetailPage.tsx` (the inline `ReferralsCard` ~line 334 — the thing to extract — plus the `deals`/`totalRevenue` memos and where `<ReferralsCard>` is rendered), `features/partners/hooks/{useAttributeDeal,useReferDeal}.ts` (add/remove hooks; `useAttributeDeal` exports `useUnattributeDeal`).

---

### Task 1: `outboundDealIds` on the partner mapper (TDD)

**Files:** `features/partners/hooks/usePartners.ts`, `features/partners/mockData.ts`, and the mapper test `features/partners/hooks/usePartners.test.tsx`.

- [ ] **Step 1: add the field to the `Partner` type** in `features/partners/mockData.ts`: add `outboundDealIds: string[];` next to `attributedDealIds`. Update any mock `Partner` fixtures in that file to include `outboundDealIds: []` (search for `attributedDealIds:` occurrences and add the sibling). `pnpm typecheck` will flag any fixture you miss.

- [ ] **Step 2: write the failing mapper test** in `usePartners.test.tsx` (mirror its existing supabase mock). A partner row whose `partner_deals` embed is `[{deal_id:"in1",direction:"inbound"},{deal_id:"out1",direction:"outbound"},{deal_id:"in2"}]` (no direction = inbound) maps to `attributedDealIds = ["in1","in2"]` and `outboundDealIds = ["out1"]`.

- [ ] **Step 3: run** `pnpm test usePartners` → FAIL. **Step 4: update the mapper** in `usePartners.ts` `toPartner`:
```ts
  const links = row.partner_deals ?? [];
  return {
    ...
    attributedDealIds: links.filter((l) => l.direction !== "outbound").map((l) => l.deal_id),
    outboundDealIds: links.filter((l) => l.direction === "outbound").map((l) => l.deal_id),
    notes: row.notes,
  };
```
(The embed already selects `direction`. No query change.)

- [ ] **Step 5: run** `pnpm test usePartners` → PASS. `pnpm typecheck` → clean. **Commit:**
```bash
git add apps/app/src/features/partners/hooks/usePartners.ts apps/app/src/features/partners/hooks/usePartners.test.tsx apps/app/src/features/partners/mockData.ts
git commit -m "feat(partners): expose outboundDealIds on the partner mapper"
```

---

### Task 2: extract `ReferralSection` (TDD)

**Files:** create `features/partners/components/ReferralSection.tsx` (+ test). (Extracted from the inline `ReferralsCard` in `PartnerDetailPage.tsx`; that file is edited in Task 3.)

- [ ] **Step 1: write `ReferralSection.test.tsx`** (wrap in `MemoryRouter`). Props per the spec:
```ts
interface ReferralSectionProps {
  title: string;
  deals: Deal[];
  eligibleOptions: Array<{ value: string; label: string }>;
  addLabel: string;
  onAdd: (dealId: string) => Promise<void>;
  onRemove: (dealId: string) => Promise<void>;
  emptyText?: string;
}
```
Tests: (a) renders `title` + a row per deal (company name + value); (b) `emptyText` shows when `deals` is empty; (c) clicking the add button reveals the picker (`eligibleOptions`), selecting a value + clicking the confirm calls `onAdd(value)`; (d) clicking a deal's remove calls `onRemove(dealId)`; (e) a deal row links to `/pipeline/:id` (assert an element navigates / has the id — mirror however the current card is testable; if it's a `navigate()` button, mock `useNavigate`). Add Radix pointer-capture polyfills for the `Select` (mirror `PipelineFilterPopover.test.tsx`).

- [ ] **Step 2: run** `pnpm test ReferralSection` → FAIL. **Step 3: implement `ReferralSection.tsx`** by extracting the existing `ReferralsCard` body from `PartnerDetailPage.tsx` and generalizing:
  - Keep the SAME markup/structure/classes as the current `ReferralsCard` (Card, header `{title} · {deals.length}`, the `Plus`/add button labelled `addLabel`, the picker with `Select` over `eligibleOptions`, the deal rows with the `/pipeline/:id` navigate button + value + `Badge` stage, and the remove `X` button).
  - Remove the internal `useAttributeDeal`/`useUnattributeDeal` hooks and the internal `eligibleOptions` computation — those move OUT (page passes `eligibleOptions`, `onAdd`, `onRemove`).
  - Manage local `picking`/`pickedDealId` state (as today). Add a local pending state: `const [busy, setBusy] = React.useState(false)`. `handleAdd`: `setBusy(true); try { await onAdd(pickedDealId); setPicking(false); setPickedDealId(""); } finally { setBusy(false); }` — disable the confirm button while `busy`. `handleRemove(id)`: `await onRemove(id)` (a `removingId` local state can disable that row's button). The page-provided `onAdd`/`onRemove` own the toasts (they re-throw on failure so the picker stays open).
  - Empty state uses `emptyText ?? "No deals yet."`.
  - Import `Deal` type, `formatMoney`, `STAGE_LABEL`/`STAGE_BADGE_KIND`, `Card`/`Button`/`Select`/`Badge`, `useNavigate`, icons — from wherever `PartnerDetailPage` currently imports them.

- [ ] **Step 4: run** `pnpm test ReferralSection` → PASS. `pnpm typecheck` → clean. **Commit:**
```bash
git add apps/app/src/features/partners/components/ReferralSection.tsx apps/app/src/features/partners/components/ReferralSection.test.tsx
git commit -m "feat(partners): extract reusable ReferralSection component"
```

---

### Task 3: wire inbound + outbound sections into `PartnerDetailPage` (TDD)

**Files:** modify `features/partners/pages/PartnerDetailPage.tsx` (+ its test).

- [ ] **Step 1: replace the inline `ReferralsCard`** definition and its single usage with two `<ReferralSection>` renders. In the page body (where `deals`/`totalRevenue` are derived):
```tsx
const inboundDeals = React.useMemo<Deal[]>(() => {
  if (!partner) return [];
  const byId = new Map(allDeals.map((d) => [d.id, d]));
  return partner.attributedDealIds.map((id) => byId.get(id)).filter(Boolean) as Deal[];
}, [partner, allDeals]);
const outboundDeals = React.useMemo<Deal[]>(() => {
  if (!partner) return [];
  const byId = new Map(allDeals.map((d) => [d.id, d]));
  return partner.outboundDealIds.map((id) => byId.get(id)).filter(Boolean) as Deal[];
}, [partner, allDeals]);
// Eligible for EITHER picker: not already linked to this partner in either direction.
const linkedIds = React.useMemo(
  () => new Set([...(partner?.attributedDealIds ?? []), ...(partner?.outboundDealIds ?? [])]),
  [partner],
);
const eligibleOptions = React.useMemo(
  () => allDeals.filter((d) => !linkedIds.has(d.id)).map((d) => ({ value: d.id, label: `${d.companyName} · ${formatMoney(d.valueCents)}` })),
  [allDeals, linkedIds],
);
```
Keep `totalRevenue`/KPIs computed from `inboundDeals` (rename the old `deals` memo to `inboundDeals`; update its references — `totalRevenue`, `dealCount`, etc. — to `inboundDeals`).

Add the hooks at the page level:
```tsx
const attribute = useAttributeDeal();
const referDeal = useReferDeal();
const unattribute = useUnattributeDeal();
const partnerId = partner!.id; // within the rendered branch where partner exists
```
Render both sections (where `<ReferralsCard ... />` was):
```tsx
<ReferralSection
  title="Referred to us"
  deals={inboundDeals}
  eligibleOptions={eligibleOptions}
  addLabel="Attach deal"
  emptyText="No deals attributed yet."
  onAdd={async (dealId) => {
    try { await attribute.mutateAsync({ partnerId, dealId }); toast.success("Deal attributed"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Could not attribute deal"); throw err; }
  }}
  onRemove={async (dealId) => {
    try { await unattribute.mutateAsync({ partnerId, dealId }); toast.success("Attribution removed"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Could not remove attribution"); throw err; }
  }}
/>
<ReferralSection
  title="Referred to them"
  deals={outboundDeals}
  eligibleOptions={eligibleOptions}
  addLabel="Refer a deal"
  emptyText="No deals referred to this partner yet."
  onAdd={async (dealId) => {
    try { await referDeal.mutateAsync({ partnerId, dealId }); toast.success("Deal referred"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Could not refer deal"); throw err; }
  }}
  onRemove={async (dealId) => {
    try { await unattribute.mutateAsync({ partnerId, dealId }); toast.success("Referral removed"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Could not remove referral"); throw err; }
  }}
/>
```
Import `ReferralSection` + `useReferDeal`; remove now-unused imports the old inline card used only (e.g. the `Plus`/`X`/`Select`/`Badge`/`SelectOption` if nothing else in the file uses them — let typecheck guide). Delete the inline `ReferralsCard` function.

- [ ] **Step 2: update the page test.** READ the existing `PartnerDetailPage` test(s). Mock `useDeals` + the partner hooks so a partner with both inbound + outbound deal ids renders. Assert: both "Referred to us" and "Referred to them" headers render with their respective deals; the outbound section's add control is present; (if feasible) outbound add calls `useReferDeal` and remove calls `useUnattributeDeal` (mock them to capturable spies). Keep existing tests green. If the existing test relied on the "Referrals" header text, update it to "Referred to us".

- [ ] **Step 3: run** `pnpm typecheck && pnpm test` (full) → clean, all green.

- [ ] **Step 4: commit:**
```bash
git add apps/app/src/features/partners/pages/PartnerDetailPage.tsx apps/app/src/features/partners/pages/PartnerDetailPage*.test.tsx apps/app/src/features/partners/pages/PartnersPage*.test.tsx
git commit -m "feat(partners): show inbound + outbound referrals on the Partner detail page"
```

---

## Notes for the implementer

- No DB/migration change — `partner_deals.direction` already exists; the embed already selects it.
- Preserve the existing inbound behavior/markup exactly — this is an extract-and-add, not a redesign.
- Partner KPIs (revenue, deal count) stay inbound-only (`inboundDeals`).
- `useUnattributeDeal` deletes by `(partner_id, deal_id)` — direction-agnostic, correct for removing either.
- `onAdd`/`onRemove` toast (success + error) and RE-THROW on error so `ReferralSection` keeps the picker open for a retry.
