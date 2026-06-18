# Deal Contacts tab — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Fill the Deal Detail "Contacts" placeholder with a real, server-backed list of additional contacts per deal (new `deal_contacts` table + RLS + CRUD hooks + UI), with the deal's primary contact shown read-only at top.

**Spec:** `/Users/ryanmeo/navigatr/docs/superpowers/specs/2026-06-18-deal-contacts-tab-design.md`

Run pnpm from `/Users/ryanmeo/navigatr/.claude/worktrees/deal-contacts/apps/app` (worktree-local `pnpm typecheck` / `pnpm test <pattern>`).

**Reference files to mirror (read them):** `features/pipeline/hooks/useCreateDeal.ts` + `useDeals.ts` (supabase insert/query idiom: `supabase` from `@/lib/supabase`, `useAuth((s)=>s.user?.id)`, react-query, snake↔camel mapper), `useCreateDeal.test.tsx` / `useDeals.test.tsx` (the supabase mock for hook tests), `components/AddPartnerSheet.tsx` (Radix Dialog sheet form pattern), `pages/DealDetailPage.tsx` (tabs + PlaceholderTab + how Edit Deal is opened).

---

### Task 1: migration + `deal_contacts` types + CRUD hooks (TDD on hooks)

**Files:** create `supabase/migrations/20260618000001_deal_contacts.sql`; create `features/pipeline/hooks/useDealContacts.ts` (+ `useDealContacts.test.tsx`).

- [ ] **Step 1: migration** — create `supabase/migrations/20260618000001_deal_contacts.sql` exactly as in the spec's section A (table `deal_contacts`, index, `deal_contacts_set_org()` trigger deriving org_id from the deal, `set_updated_at` trigger, RLS enable + 4 policies). Header comment: `-- HAND-APPLIED (NOT db push): supabase db query --linked -f supabase/migrations/20260618000001_deal_contacts.sql`. (SQL isn't run by vitest; it's hand-applied later.)

- [ ] **Step 2: write `useDealContacts.test.tsx`** — mirror the supabase-mock scaffolding from `useCreateDeal.test.tsx`/`useDeals.test.tsx` (read it). Cover:
  - `useDealContacts(dealId)` queries `deal_contacts` filtered by `deal_id`, ordered, and maps rows to the `DealContact` camel shape.
  - `useCreateDealContact` inserts `{ deal_id, created_by, name, title, email, phone, role, note }` (NOT org_id — the trigger sets it) and invalidates `["deal-contacts", dealId]`.
  - `useUpdateDealContact` updates by id with the patch; `useDeleteDealContact` deletes by id; both invalidate.
  Use whatever mock shape the reference tests use (chainable `from().select().eq().order()` / `.insert().select().single()` / `.update().eq()` / `.delete().eq()`).

- [ ] **Step 3: run** `pnpm test useDealContacts` → FAIL (module missing).

- [ ] **Step 4: implement `features/pipeline/hooks/useDealContacts.ts`** — export the `DealContact` type, query key, mapper, and 4 hooks. Skeleton (fill supabase calls mirroring useCreateDeal/useDeals):
```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export interface DealContact {
  id: string; dealId: string; name: string;
  title: string | null; email: string | null; phone: string | null;
  role: string | null; note: string | null; createdAt: string;
}
interface DealContactRow {
  id: string; deal_id: string; name: string;
  title: string | null; email: string | null; phone: string | null;
  role: string | null; note: string | null; created_at: string;
}
function toContact(r: DealContactRow): DealContact {
  return { id: r.id, dealId: r.deal_id, name: r.name, title: r.title, email: r.email, phone: r.phone, role: r.role, note: r.note, createdAt: r.created_at };
}
export const DEAL_CONTACTS_KEY = (dealId: string) => ["deal-contacts", dealId] as const;

export function useDealContacts(dealId: string) {
  return useQuery({
    queryKey: DEAL_CONTACTS_KEY(dealId),
    queryFn: async (): Promise<DealContact[]> => {
      const { data, error } = await supabase
        .from("deal_contacts").select("*").eq("deal_id", dealId).order("created_at", { ascending: true });
      if (error) throw error;
      return (data as DealContactRow[]).map(toContact);
    },
    enabled: !!dealId,
  });
}

export interface DealContactInput { name: string; title?: string; email?: string; phone?: string; role?: string; note?: string; }

export function useCreateDealContact() {
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async ({ dealId, ...input }: DealContactInput & { dealId: string }) => {
      if (!userId) throw new Error("Not signed in");
      const { data, error } = await supabase.from("deal_contacts").insert({
        deal_id: dealId, created_by: userId,
        name: input.name, title: input.title ?? null, email: input.email ?? null,
        phone: input.phone ?? null, role: input.role ?? null, note: input.note ?? null,
      }).select("id").single();
      if (error) throw error;
      return { id: data.id as string };
    },
    onSuccess: (_r, vars) => { void qc.invalidateQueries({ queryKey: DEAL_CONTACTS_KEY(vars.dealId) }); },
  });
}

export function useUpdateDealContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dealId, patch }: { id: string; dealId: string; patch: Partial<DealContactInput> }) => {
      const { error } = await supabase.from("deal_contacts").update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.title !== undefined ? { title: patch.title ?? null } : {}),
        ...(patch.email !== undefined ? { email: patch.email ?? null } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone ?? null } : {}),
        ...(patch.role !== undefined ? { role: patch.role ?? null } : {}),
        ...(patch.note !== undefined ? { note: patch.note ?? null } : {}),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_r, vars) => { void qc.invalidateQueries({ queryKey: DEAL_CONTACTS_KEY(vars.dealId) }); },
  });
}

export function useDeleteDealContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; dealId: string }) => {
      const { error } = await supabase.from("deal_contacts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_r, vars) => { void qc.invalidateQueries({ queryKey: DEAL_CONTACTS_KEY(vars.dealId) }); },
  });
}
```

- [ ] **Step 5: run** `pnpm test useDealContacts` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 6: commit:**
```bash
git add supabase/migrations/20260618000001_deal_contacts.sql apps/app/src/features/pipeline/hooks/useDealContacts.ts apps/app/src/features/pipeline/hooks/useDealContacts.test.tsx
git commit -m "feat(pipeline): deal_contacts table + CRUD hooks"
```

---

### Task 2: `DealContactSheet` + `ContactsTab` (TDD)

**Files:** create `features/pipeline/components/DealContactSheet.tsx` (+ test), `features/pipeline/components/ContactsTab.tsx` (+ test), and a `lib/dealContactRoles.ts` const.

- [ ] **Step 1: roles const** — `lib/dealContactRoles.ts`:
```ts
export const DEAL_CONTACT_ROLES: Array<{ value: string; label: string }> = [
  { value: "decision_maker", label: "Decision maker" },
  { value: "gatekeeper", label: "Gatekeeper" },
  { value: "influencer", label: "Influencer" },
  { value: "champion", label: "Champion" },
  { value: "billing", label: "Billing" },
  { value: "other", label: "Other" },
];
export function roleLabel(value: string | null): string | null {
  if (!value) return null;
  return DEAL_CONTACT_ROLES.find((r) => r.value === value)?.label ?? value;
}
```

- [ ] **Step 2: `DealContactSheet.test.tsx`** — wrap in `QueryClientProvider`; mock `./useDealContacts`-adjacent hooks if needed (or mock `useCreateDealContact`/`useUpdateDealContact` to capture mutate args). Assert: renders fields; submit disabled when name blank; entering a name + submitting calls create with `{ dealId, name, ... }`; in edit mode (contact prop) fields prefill and submit calls update. Add Radix pointer-capture polyfills (mirror PipelineFilterPopover.test.tsx) for the role Select.

- [ ] **Step 3: run** `pnpm test DealContactSheet` → FAIL. **Step 4: implement `DealContactSheet.tsx`** — Radix Dialog mirroring `AddPartnerSheet.tsx`. Props `{ open, onOpenChange, dealId, contact? }`. Fields: name (`Input`, required), title (`Input`), email (`Input` type email), phone (`Input`), role (navigatr `Select`, options `DEAL_CONTACT_ROLES`, optional → allow unset), note (`NotesFieldWithMic` or `Textarea`). Local form state seeded from `contact` when editing. Submit button disabled when `name.trim() === ""`; calls `useCreateDealContact().mutateAsync({ dealId, ...fields })` or `useUpdateDealContact().mutateAsync({ id, dealId, patch })`; on success `onOpenChange(false)`; on error `toast.error`.

- [ ] **Step 5: run** `pnpm test DealContactSheet` → PASS.

- [ ] **Step 6: `ContactsTab.test.tsx`** — mock `./useDealContacts` (`useDealContacts` returns `{ data, isLoading }`). Assert: renders the primary card from `deal` (company primary name + a "Primary" label); renders additional contacts from mocked data (names + role pill via `roleLabel`); empty state when `data` is `[]`; clicking "Add contact" opens the sheet (the sheet's dialog title shows). Wrap in `MemoryRouter` + `QueryClientProvider` as needed.

- [ ] **Step 7: run** `pnpm test ContactsTab` → FAIL. **Step 8: implement `ContactsTab.tsx`** — props `{ deal: Deal; onEditPrimary?: () => void }`:
  - Primary card: "Primary" eyebrow, `deal.contactName`, `PhoneWithClickToCall` (`deal.phone`) when present, email `mailto` when present, an "Edit" button calling `onEditPrimary?.()` (if provided).
  - Additional: `const { data, isLoading } = useDealContacts(deal.id)`. Loading → a small spinner/skeleton. Each contact → a card (name, title, `roleLabel(role)` pill if set, phone/email affordances, Edit + Delete). Edit opens `DealContactSheet` with that contact; Delete → `window.confirm` then `useDeleteDealContact().mutateAsync({ id, dealId: deal.id })`. Empty → "No additional contacts yet" + the Add CTA. An "Add contact" button (top-right of the section) opens `DealContactSheet` with no contact.

- [ ] **Step 9: run** `pnpm test ContactsTab DealContactSheet` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 10: commit:**
```bash
git add apps/app/src/features/pipeline/components/DealContactSheet.tsx apps/app/src/features/pipeline/components/DealContactSheet.test.tsx apps/app/src/features/pipeline/components/ContactsTab.tsx apps/app/src/features/pipeline/components/ContactsTab.test.tsx apps/app/src/features/pipeline/lib/dealContactRoles.ts
git commit -m "feat(pipeline): ContactsTab + DealContactSheet (additional deal contacts)"
```

---

### Task 3: wire `ContactsTab` into `DealDetailPage`

**Files:** modify `apps/app/src/features/pipeline/pages/DealDetailPage.tsx` (+ extend its test if one exists).

- [ ] **Step 1:** READ `DealDetailPage.tsx`. Find the Contacts `Tabs.Content` that currently renders `<PlaceholderTab title="Contacts" />` and how the page opens the Edit Deal sheet (there's an edit affordance for marking lost / editing — locate the existing edit handler/sheet). Replace the Contacts placeholder with:
```tsx
<ContactsTab deal={deal} onEditPrimary={() => /* open the existing Edit Deal sheet */} />
```
If wiring `onEditPrimary` to the existing edit sheet is non-trivial, pass it only if an edit handler is readily available; otherwise omit `onEditPrimary` (the prop is optional and the Edit button simply won't render). Do NOT build a new edit sheet here. Import `ContactsTab`.

- [ ] **Step 2:** Add/extend a DealDetailPage test: navigating to the Contacts tab renders the primary contact (and the "Add contact" affordance) instead of "Coming in sprint 2". Mock `useDealContacts` to `{ data: [], isLoading: false }`. Keep existing DealDetailPage tests green.

- [ ] **Step 3:** `pnpm typecheck && pnpm test` (full) → clean, all green. Remove the now-unused `PlaceholderTab` import only if Notes & Files no longer uses it (it does — Notes is still a placeholder; keep it).

- [ ] **Step 4: commit:**
```bash
git add apps/app/src/features/pipeline/pages/DealDetailPage.tsx apps/app/src/features/pipeline/pages/*DealDetail*.test.tsx
git commit -m "feat(pipeline): wire ContactsTab into Deal Detail"
```

---

## Notes for the implementer

- `org_id` is NEVER sent from the client for deal_contacts — the BEFORE-INSERT trigger derives it
  from the deal. Inserts pass `deal_id`, `created_by`, and fields.
- Mirror the existing supabase mock from `useCreateDeal.test.tsx`/`useDeals.test.tsx` for hook
  tests — do not invent a new mocking style.
- Reuse `PhoneWithClickToCall`, `NotesFieldWithMic`/`Textarea`, `Input`, `Select`, `Button`,
  `Card` from `@/components/navigatr`; don't restyle them.
- Keep the Notes & Files tab as its placeholder (separate sub-project).
- The migration is hand-applied later (like voice_notes / deal_contacts) — it won't run in CI/tests.
