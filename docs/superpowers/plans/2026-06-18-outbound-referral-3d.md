# FR-PIPE-09 outbound referral — slice 3d plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Send a deal as an outbound referral to a partner from Deal Detail. Adds a `direction` column to `partner_deals`, a `useReferDeal` mutation, an inbound-only filter on the partners attribution embed, a `SendReferralSheet`, and wires the Quick action.

**Spec:** `/Users/ryanmeo/navigatr/docs/superpowers/specs/2026-06-18-outbound-referral-3d-design.md`

Run pnpm from `/Users/ryanmeo/navigatr/.claude/worktrees/referral/apps/app`.

---

### Task 1: Migration + `useReferDeal` + `usePartners` inbound filter (TDD)

**Files:** create `supabase/migrations/20260618000001_partner_deal_direction.sql`, `apps/app/src/features/partners/hooks/useReferDeal.ts` (+ test); modify `usePartners.ts` (+ its test if present).

- [ ] **Step 1: Migration.** Create `supabase/migrations/20260618000001_partner_deal_direction.sql`:
```sql
-- 20260618000001_partner_deal_direction.sql
-- FR-PIPE-09: distinguish inbound (partner referred a deal to us) from outbound
-- (we referred a deal to a partner). Default 'inbound' keeps existing links intact.
-- HAND-APPLIED (NOT db push):
--   supabase db query --linked -f supabase/migrations/20260618000001_partner_deal_direction.sql
alter table partner_deals
  add column if not exists direction text not null default 'inbound'
  check (direction in ('inbound', 'outbound'));
```

- [ ] **Step 2: `useReferDeal` test** — create `apps/app/src/features/partners/hooks/useReferDeal.test.tsx`. READ `useAttributeDeal.test.tsx` (if it exists) or `usePartners.test.tsx` to copy the supabase + auth/profile mock pattern. Assert that calling the mutation inserts into `partner_deals` with `direction: "outbound"`, the right `partner_id`/`deal_id`/`notes`, and that it invalidates the partners query. Match the existing mock-assertion style for the `.insert(...)` payload.

- [ ] **Step 3: Run** the new test → FAIL.

- [ ] **Step 4: Create `useReferDeal.ts`** — copy `useAttributeDeal.ts` verbatim, rename the hook/types to `useReferDeal`/`ReferDealInput`, and add `direction: "outbound"` to the `.insert({...})` object. Keep the same guards, org_id handling, and `onSuccess` invalidation of `PARTNERS_QUERY_KEY(userId)`. Update the doc comment to say "outbound referral (we referred a deal TO a partner)".

- [ ] **Step 5: `usePartners` inbound filter.** In `apps/app/src/features/partners/hooks/usePartners.ts`:
  - Change the embed in the `.select(...)` from `partner_deals(deal_id)` to `partner_deals(deal_id, direction)`.
  - In `PartnerRow`, type the embed as `Array<{ deal_id: string; direction?: string }> | null`.
  - In the row mapper, build `attributedDealIds` from only inbound rows:
    `(row.partner_deals ?? []).filter((l) => l.direction !== "outbound").map((l) => l.deal_id)`.
  - If `usePartners.test.tsx` exists and asserts on `attributedDealIds`/the embed shape, update its mock rows to include `direction` and add a case proving an `outbound` row is excluded.

- [ ] **Step 6: Run** `pnpm --filter app test useReferDeal usePartners` → green. Then `pnpm --filter app typecheck && pnpm --filter app test` → clean/green.

- [ ] **Step 7: Commit:**
```bash
git add supabase/migrations/20260618000001_partner_deal_direction.sql apps/app/src/features/partners/hooks/useReferDeal.ts apps/app/src/features/partners/hooks/useReferDeal.test.tsx apps/app/src/features/partners/hooks/usePartners.ts apps/app/src/features/partners/hooks/usePartners.test.tsx
git commit -m "feat(partners): partner_deals.direction + useReferDeal (outbound); inbound-only attribution (FR-PIPE-09 data)"
```
(Drop usePartners.test.tsx from the add list if it doesn't exist.)

---

### Task 2: `SendReferralSheet` + wire the Quick action

**Files:** create `apps/app/src/features/pipeline/components/SendReferralSheet.tsx` (+ test); modify `pages/DealDetailPage.tsx`.

- [ ] **Step 1: Implement `SendReferralSheet.tsx`** — Radix dialog mirroring `StageUpdateModal.tsx` (read it for the shell + Button/Input usage). Props `{ open; onOpenChange; deal: Deal }`. Body:
  - `const { data: partners = [] } = usePartners();`
  - A partner picker: a navigatr `Select` whose options are `partners.map((p) => ({ value: p.id, label: `${p.name} · ${p.company}` }))`, plus a local `partnerId` state. (If `Select` needs a placeholder option, include one.)
  - Optional notes: `NotesFieldWithMic` (or `Textarea`), `notes` state.
  - Footer Cancel + "Send referral" (disabled when `!partnerId || refer.isPending`).
  - `const refer = useReferDeal();` Save:
```tsx
const onSend = async () => {
  if (!partnerId) return;
  try {
    await refer.mutateAsync({ dealId: deal.id, partnerId, notes: notes.trim() || undefined });
    toast.success(`Referred ${deal.companyName}`);
    onOpenChange(false);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Couldn't send referral");
  }
};
```
  - Empty partners: render "No partners yet — add one in Partners." and disable send.
  - Reset `partnerId`/`notes` on open (effect keyed on `open`).
  Imports: `usePartners` from `@/features/partners/hooks/usePartners`, `useReferDeal` from `@/features/partners/hooks/useReferDeal`, `toast`, Dialog, Button, Select, NotesFieldWithMic, `type Deal`.

- [ ] **Step 2: Test `SendReferralSheet.test.tsx`** — mock `@/features/partners/hooks/usePartners` to return two partners; mock `@/features/partners/hooks/useReferDeal` with a `mutateAsyncSpy`; mock `sonner`. Render open with a deal; assert send is disabled initially; select a partner (drive the navigatr `Select` — if Radix, add the pointer-capture polyfills like `DealDetailPage.stage-picker.test.tsx` does and click an option; if it's a native select, `fireEvent.change`); click "Send referral"; assert `mutateAsyncSpy` called with `expect.objectContaining({ dealId: <id>, partnerId: <picked> })`. Add an empty-partners case asserting the hint shows and send is disabled. Report how you drove the Select.

- [ ] **Step 3: Wire `DealDetailPage.tsx`.** Import `SendReferralSheet`; add `const [referralOpen, setReferralOpen] = React.useState(false)`; pass `onSendReferral={() => setReferralOpen(true)}` to `<QuickActionsCard … />` (the prop exists); render `<SendReferralSheet open={referralOpen} onOpenChange={setReferralOpen} deal={deal} />` near the other page-level sheets.

- [ ] **Step 4:** `pnpm --filter app typecheck && pnpm --filter app test` → clean/green. Commit:
```bash
git add apps/app/src/features/pipeline/components/SendReferralSheet.tsx apps/app/src/features/pipeline/components/SendReferralSheet.test.tsx apps/app/src/features/pipeline/pages/DealDetailPage.tsx
git commit -m "feat(pipeline): Send-as-referral sheet wired to Quick actions (FR-PIPE-09)"
```

---

## Notes for the implementer

- The migration is **hand-applied** to prod (the controller applies it after merge); it's
  idempotent. Frontend code references `direction` only on insert (outbound) + the partners
  embed filter — both degrade to a toast error if the column is missing, so shipping order is
  migration-then-rely.
- `useReferDeal` is a near-copy of `useAttributeDeal` + `direction: "outbound"`.
- Keep inbound attribution correct: outbound rows must not appear in `attributedDealIds`.
- Reuse the existing `Select`/`NotesFieldWithMic`/dialog primitives; no new dependency.
- Keep all existing tests green (esp. any partners-hook test asserting the embed shape).
