# Pipeline Prospect De-duplication: Design Spec

**Date:** 2026-07-24
**Status:** Approved (pending spec review)
**Module:** Path discovery + Pipeline deal creation
**Origin:** Reps can add the same business to the pipeline twice. Discovery keeps returning a prospect after it's already a deal, so a later Drop-In creates a duplicate; manual add has no guard either.

---

## 1. Problem and root cause

Discovered prospects each carry a stable Google **`place_id`**. A Drop-In creates a deal from the business name, address, and phone but does **not** store the `place_id`, so the deal loses the clean link to that exact business. Within one Path run, re-logging a stop is already guarded (`dealCreated` flag); the gap is **across runs, over time**: `discover_prospects` still returns a business that's already in the pipeline, and a later Drop-In (or a manual add) creates a second deal.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Mechanism | **Both**: hide already-in-pipeline prospects from discovery AND enforce a no-duplicate guard on add. |
| Scope | **Org-wide**: a prospect is a duplicate if anyone in the tenant already has it (territory hygiene for the ISO team model). |
| Which deals dedupe | **Active only**: stage NOT in (`won`, `lost`). A closed deal frees the business to be rediscovered and re-worked. |
| Identity key | Google **`place_id`** (present on every discovered prospect). Manual and legacy deals have no place_id and are out of scope for v1 dedupe (see section 6). |

## 3. Foundation: store `place_id` on the deal

- Add a nullable column `deals.place_id text`.
- Thread the prospect's `placeId` (already on the `Merchant` shape, from `ProspectRow.place_id`) through the Drop-In: `DropInSheet` passes it to `useCreateDeal`, which inserts it. Manual deal creation leaves it null.
- Indexes:
  - `create index deals_org_place_idx on deals (org_id, place_id) where place_id is not null;` for a fast discovery-exclusion join.
  - **Partial unique index** `deals_org_place_active_uidx on deals (org_id, place_id) where place_id is not null and stage not in ('won','lost')`. This is the hard guarantee that two ACTIVE deals in a tenant can't share a place_id. When a deal is won or lost it leaves this index, freeing the place_id (matches the active-only decision).

## 4. Mechanism A: hide from discovery (org-wide, active-only)

`prospects_nearby` RPC gains an exclusion: drop any prospect whose `place_id` matches a deal in the caller's org with stage not in (`won`, `lost`). SQL sketch added to the RPC body:
```sql
and not exists (
  select 1 from deals d
  where d.place_id = p.place_id
    and d.org_id = v_org_id           -- caller's org (from auth.uid() -> profiles, or a param)
    and d.stage not in ('won','lost')
)
```
The plan determines whether `v_org_id` is derived inside the RPC from `auth.uid()` or passed by the `discover_prospects` edge function (whichever matches how the edge function currently authenticates the call). Result: an active-pipeline business never appears in Path discovery for anyone on the team.

## 5. Mechanism B: block on add (de-dupe guard)

- The **partial unique index** (section 3) is the backstop.
- The Drop-In create path is made dedupe-aware: before inserting, look up an existing ACTIVE deal by (org_id, place_id); if one exists, do NOT create a duplicate. Instead surface a clear message ("{business} is already in your team's pipeline") with an action to **open the existing deal**. If the insert still hits the unique index (a race, or an out-of-date client), catch the Postgres unique-violation (23505) and show the same friendly handling rather than a raw error.
- Because Mechanism A already hides in-pipeline prospects, B mainly fires on edge cases (a prospect that entered the pipeline between search and drop-in, a concurrent double-add, or a manual overlap). It must never surface as a crash or a silent duplicate.

## 6. Non-goals (v1)

- **Manual-add name+address fuzzy dedupe.** A business typed manually (no place_id) won't dedupe against a discovered one. The stated problem is discovery-driven duplication, which place_id fully covers. Fuzzy name+address matching for manual adds is a deferred enhancement (noted, not built).
- Merging existing duplicates already in the pipeline (a cleanup tool) is a separate follow-up.
- Cross-location handling: different physical locations of a business have different place_ids and are correctly treated as distinct (chains are already filtered at ingest).

## 7. Edge cases

- **Closed then re-worked:** a won or lost deal does not hide or block; the prospect reappears and a new active deal can be created. The old closed deal is untouched.
- **Concurrent double-add (two reps):** the unique index rejects the second; the client shows "already in pipeline, open it".
- **PLACES_MOCK on prod:** mock prospects carry place_ids, so hide and dedupe work in mock discovery too.
- **Legacy active deals with null place_id:** not excluded or deduped (can't match); acceptable for v1. Backfilling place_id onto legacy deals is out of scope.

## 8. Testing

- Client: unit and component tests that the Drop-In threads `placeId` into `useCreateDeal`; that the dedupe-aware create surfaces the "already in pipeline / open existing" path when an active deal exists; and that a won or lost existing deal does NOT block a new create.
- SQL (RPC + indexes) verified by manual QA plus the repo's `supabase/tests` pattern where practical: a prospect with an active deal is excluded from `prospects_nearby`; a won or lost one is not; the partial unique index rejects a second active deal for the same (org, place_id).
- Full `pnpm --filter app test` and `typecheck` green.

## 9. Deploy

Migration (add column + 2 indexes + `prospects_nearby` update) applied by pasting the SQL into the Supabase SQL editor (project's standard flow), then push the frontend. The exclusion and column are backward-compatible (null place_id on existing deals).

## 10. Files (anticipated)

- Migration: `supabase/migrations/<ts>_pipeline_place_id_dedupe.sql` (column + indexes + `prospects_nearby` rebuild).
- `apps/app/src/features/pipeline/hooks/useCreateDeal.ts` (accept and insert `placeId`; dedupe-aware error handling).
- `apps/app/src/features/path/components/DropInSheet.tsx` (pass `merchant.placeId`; handle the "already in pipeline" response with an open-existing action).
- Possibly a small pure helper for the dedupe decision plus a lookup (existing active deal by place_id) reused by the create path.
