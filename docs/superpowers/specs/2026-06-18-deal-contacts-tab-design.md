# Deal Contacts tab (2026-06-18)

Sub-project A of the Deal Detail placeholder tabs (Contacts first; Notes & Files is a separate
later sub-project). Fills the "Contacts" tab, currently a `PlaceholderTab` ("Coming in sprint
2"), with a real, server-backed list of additional contacts per deal.

## Decisions (locked in brainstorming)

- **Primary stays on the deal.** The deal's existing primary contact (`contact_name/title/email/
  phone` on `deals`) is shown at the top of the tab as a read-only "Primary" card, edited via the
  existing **Edit Deal** sheet. The new table holds only *additional* contacts. Non-destructive;
  the deal's denormalized primary remains the single source read by the pipeline card/header.
- **Per-contact fields:** name (required), title, email, phone, **role** (fixed Select), **note**
  (freeform). 
- **Server-backed**, consistent with the app (new table + RLS + hand-applied migration + hooks),
  mirroring the partners CRUD pattern.

## Architecture

### A. Migration `supabase/migrations/<ts>_deal_contacts.sql` (hand-applied)
```sql
create table deal_contacts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  deal_id     uuid not null references deals(id) on delete cascade,
  name        text not null,
  title       text,
  email       text,
  phone       text,                 -- E.164-ish; nullable
  role        text,                 -- e.g. 'decision_maker' (UI offers a fixed set)
  note        text,
  created_by  uuid not null references profiles(id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index deal_contacts_deal_idx on deal_contacts (deal_id, created_at);

-- org_id is derived from the parent deal so the client never sends it and it can't drift.
create or replace function deal_contacts_set_org() returns trigger language plpgsql as $$
begin
  select org_id into new.org_id from deals where id = new.deal_id;
  return new;
end $$;
create trigger deal_contacts_set_org_trg
  before insert or update of deal_id on deal_contacts
  for each row execute function deal_contacts_set_org();

create trigger deal_contacts_set_updated_at
  before update on deal_contacts for each row execute function set_updated_at();

alter table deal_contacts enable row level security;
-- Deals are org-shared, so their contacts follow. Any org member can read/manage.
create policy deal_contacts_select on deal_contacts for select using (org_id = public.user_org_id());
create policy deal_contacts_insert on deal_contacts for insert
  with check (org_id = public.user_org_id() and created_by = auth.uid());
create policy deal_contacts_update on deal_contacts for update
  using (org_id = public.user_org_id()) with check (org_id = public.user_org_id());
create policy deal_contacts_delete on deal_contacts for delete using (org_id = public.user_org_id());
```
Note: the insert policy checks `org_id = user_org_id()`, and the BEFORE-INSERT trigger sets
`org_id` from the deal — so inserting a contact onto a deal in another org fails the check
(the derived org_id won't match the user's org). The client passes `deal_id`, `created_by`
(self), and the fields; not `org_id`.

### B. Hooks (`features/pipeline/hooks/`, mirroring partners CRUD)
- `useDealContacts(dealId)` → list ordered by `created_at`. Query key `["deal-contacts", dealId]`.
- `useCreateDealContact()` → insert `{ deal_id, created_by: auth.uid(), name, title?, email?, phone?, role?, note? }`; onSuccess invalidate the deal's contacts key.
- `useUpdateDealContact()` → `{ id, patch }`.
- `useDeleteDealContact()` → `{ id, dealId }`.
A row→`DealContact` mapper (snake→camel) like `useDeals`.

### C. UI
- **`ContactsTab.tsx`** (replaces `<PlaceholderTab title="Contacts">`), props `{ deal: Deal }`:
  - **Primary card** — labeled "Primary"; `deal.contactName`, `deal.contactTitle?`, with
    `PhoneWithClickToCall` (`deal.phone`) + email `mailto`. A small "Edit" opens the existing
    Edit Deal sheet (reuse the page's existing edit affordance / callback).
  - **Additional contacts** — `useDealContacts(deal.id)`; a list of contact cards (name, title,
    **role pill**, tap-to-call/email, edit + delete buttons). An **"Add contact"** button opens
    `DealContactSheet`. Empty state ("No additional contacts yet") with the add CTA. Loading
    skeleton/spinner while the query loads.
- **`DealContactSheet.tsx`** (Radix Dialog, mirroring `AddPartnerSheet`), props `{ open,
  onOpenChange, dealId, contact? }` (contact present → edit mode): fields name (required), title,
  email, phone, **role** (navigatr `Select`: Decision maker / Gatekeeper / Influencer / Champion
  / Billing / Other), **note** (`NotesFieldWithMic` or textarea). Submit → create or update;
  disable submit when name is blank; toast on error. Delete handled from the card (confirm).
- Role options: a `DEAL_CONTACT_ROLES` const (value+label) shared by the sheet (Select) and the
  card (pill label lookup).

### D. Wiring
`DealDetailPage`: replace the Contacts `PlaceholderTab` with `<ContactsTab deal={deal} />`. No
change to other tabs.

## Data flow

`DealDetailPage` (has `deal`) → `ContactsTab` → `useDealContacts(deal.id)` for the additional
list; primary read from the `deal` prop. Create/update/delete via hooks → invalidate
`["deal-contacts", dealId]` → list refetches. The deal's primary is unaffected (edited via Edit
Deal, which already invalidates the deal query).

## Error handling / edge cases

- **Name required** — sheet submit disabled until non-empty; DB `not null` backstops.
- **No email/phone** — those fields nullable; the card omits the call button / mailto when absent.
- **Empty list** — empty state with the "Add contact" CTA.
- **Delete** — `window.confirm` before delete; optimistic-free (await + invalidate).
- **Org isolation** — enforced by RLS + the org-deriving trigger; a contact can't be attached to
  another org's deal.
- **Create/update failure** — toast; sheet stays open so the rep can retry.

## Testing

- Hook tests (permissive Supabase mock, like existing hook tests): `useDealContacts` lists for a
  deal; create/update/delete call the right table ops and invalidate.
- `ContactsTab`: renders the primary card from the deal; renders additional contacts from a mocked
  `useDealContacts`; shows the empty state with no additional contacts; "Add contact" opens the
  sheet.
- `DealContactSheet`: submit disabled with blank name; submitting create calls
  `useCreateDealContact` with the entered fields; edit mode prefills and calls update.

## Out of scope

Notes & Files tab (sub-project B); linking contacts to activities; per-contact interaction
history; contact import; making additional contacts selectable as the deal's primary (the primary
stays edited via Edit Deal).
