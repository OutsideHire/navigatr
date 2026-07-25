# Pipeline Prospect De-duplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the same business being added to the pipeline twice: anchor deals to the Google `place_id`, hide already-in-pipeline prospects from Path discovery org-wide, and block a duplicate add with a friendly message instead of a second deal.

**Architecture:** One SQL migration adds `deals.place_id` plus two indexes (a lookup index and a partial UNIQUE index that guarantees at most one ACTIVE deal per (org, place_id)), and extends the `prospects_nearby` RPC to exclude any prospect already tied to an active deal in the caller's org. The client stamps the prospect's `place_id` onto the deal on the Drop-In path; `useCreateDeal` catches the unique-violation and throws a typed `DuplicateDealError`; `DropInSheet` turns that into a calm "already in your team's pipeline" message (no duplicate, no scary error). "Active" means stage NOT in (`won`, `lost`), so closed deals free the business to be rediscovered.

**Tech Stack:** Supabase Postgres (migration applied via SQL editor), React + TypeScript, TanStack Query, vitest + Testing Library, sonner toasts.

---

### Task 1: Migration - place_id column, indexes, discovery exclusion

**Files:**
- Create: `supabase/migrations/20260724000001_pipeline_place_id_dedupe.sql`

This task is SQL applied via the Supabase SQL editor (project standard, not `supabase db push`), so it has no vitest coverage; correctness is proven by the verification queries in Step 3 and by the client tests in Tasks 2 and 3.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260724000001_pipeline_place_id_dedupe.sql` with exactly:

```sql
-- 20260724000001_pipeline_place_id_dedupe.sql
--
-- Pipeline prospect de-duplication. Anchor each deal to the Google place_id so a
-- business already tied to an ACTIVE deal (anyone in the org) is BOTH hidden from
-- Path discovery and blocked from being added a second time. "Active" = stage not
-- in ('won','lost'): a closed deal frees the business to be rediscovered/re-worked.

-- 1. Store the prospect fingerprint on the deal. Nullable: manual + legacy deals
--    have no place_id and are intentionally out of scope for de-dup.
alter table deals add column if not exists place_id text;

-- 2a. Fast lookup for the discovery-exclusion join (Mechanism A).
create index if not exists deals_org_place_idx
  on deals (org_id, place_id)
  where place_id is not null;

-- 2b. Hard org-wide guarantee (Mechanism B): at most one ACTIVE deal per
--     (org, place_id). A won/lost deal drops out of this partial index, so the
--     same business can be re-added later as a fresh active deal.
create unique index if not exists deals_org_place_active_uidx
  on deals (org_id, place_id)
  where place_id is not null and stage not in ('won','lost');

-- 3. Discovery hides any prospect already in an active deal for the caller's org.
--    Body is identical to 20260702000001 plus the NOT EXISTS clause. SECURITY
--    DEFINER, so the deals read bypasses RLS; org is scoped explicitly via
--    public.user_org_id() (resolves from the caller's JWT, same as the RLS
--    policies). create or replace keeps the existing 7-arg grant.
create or replace function prospects_nearby(
  p_lat            double precision,
  p_lng            double precision,
  p_radius_m       double precision default 3000,
  p_profession     text default null,
  p_limit          integer default 30,
  p_include_chains boolean default false,
  p_categories     text[] default null
)
returns table (
  id               uuid,
  place_id         text,
  name             text,
  category         text,
  address          text,
  lat              double precision,
  lng              double precision,
  phone            text,
  website          text,
  employee_count   integer,
  rating_count     integer,
  rating           double precision,
  primary_type     text,
  is_chain         boolean,
  chain_confidence text,
  chain_brand_name text,
  distance_m       double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    p.id, p.place_id, p.name, p.category, p.address,
    p.lat, p.lng, p.phone, p.website, p.employee_count, p.rating_count, p.rating, p.primary_type,
    p.is_chain, p.chain_confidence, p.chain_brand_name,
    ST_Distance(p.location, ST_MakePoint(p_lng, p_lat)::geography) as distance_m
  from prospects p
  where p.in_profile
    and (p_include_chains or not p.is_chain)
    and (p_categories is null or p.category = any(p_categories))
    and ST_DWithin(p.location, ST_MakePoint(p_lng, p_lat)::geography, p_radius_m)
    and not exists (
      select 1 from deals d
      where d.place_id = p.place_id
        and d.org_id = public.user_org_id()
        and d.stage not in ('won','lost')
    )
  order by distance_m asc
  limit greatest(1, least(coalesce(p_limit, 30), 500));
$$;
```

- [ ] **Step 2: Commit the migration**

```bash
git add -f supabase/migrations/20260724000001_pipeline_place_id_dedupe.sql
git commit -m "feat(pipeline): migration for place_id dedupe (column, indexes, discovery exclusion)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 3: Record the manual verification queries (for the deploy handoff in Task 4)**

These run in the Supabase SQL editor AFTER the user pastes the migration. They are not part of CI. Note them in the Task 4 handoff message:

```sql
-- a) Column + both indexes exist:
select column_name from information_schema.columns
  where table_name='deals' and column_name='place_id';
select indexname from pg_indexes where tablename='deals'
  and indexname in ('deals_org_place_idx','deals_org_place_active_uidx');

-- b) Unique index blocks a 2nd ACTIVE deal for the same (org, place_id):
--    insert two 'new' deals with the same place_id in one org -> 2nd raises 23505.
-- c) A won/lost deal for a place_id does NOT block a new active one (no error).
-- d) prospects_nearby near a seeded active deal's coordinates omits that prospect;
--    marking the deal 'lost' makes it reappear.
```

---

### Task 2: useCreateDeal - stamp place_id + throw DuplicateDealError

**Files:**
- Modify: `apps/app/src/features/pipeline/hooks/useCreateDeal.ts`
- Test: `apps/app/src/features/pipeline/hooks/useCreateDeal.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add these three tests inside the `describe("useCreateDeal", ...)` block in `useCreateDeal.test.tsx`. Also add the import of `DuplicateDealError` to the existing top import: change `import { useCreateDeal } from "./useCreateDeal";` to `import { useCreateDeal, DuplicateDealError } from "./useCreateDeal";`.

```tsx
  it("stamps place_id onto the insert payload when provided", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "deal-pid" }, error: null });
    const { result } = renderHook(() => useCreateDeal(), { wrapper });
    await result.current.mutateAsync({
      companyName: "Bluewater", contactName: "Bluewater",
      contactPhone: "+12025550100", stage: "new", probability: 20,
      leadSource: "path_dropin", placeId: "gp-blue-1",
    });
    const calls = insertMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(calls[0]?.[0]).toMatchObject({ place_id: "gp-blue-1" });
  });

  it("inserts null place_id when omitted (manual deal)", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "deal-nopid" }, error: null });
    const { result } = renderHook(() => useCreateDeal(), { wrapper });
    await result.current.mutateAsync({
      companyName: "Acme", contactName: "Jane", contactPhone: "+12025550100",
      stage: "new", probability: 20,
    });
    const calls = insertMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(calls[0]?.[0]).toMatchObject({ place_id: null });
  });

  it("throws DuplicateDealError on a unique-violation (23505)", async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "deals_org_place_active_uidx"',
      },
    });
    const { result } = renderHook(() => useCreateDeal(), { wrapper });
    await expect(
      result.current.mutateAsync({
        companyName: "Dupe", contactName: "Dupe", contactPhone: "+12025550100",
        stage: "new", probability: 20, placeId: "gp-dupe-1",
      }),
    ).rejects.toBeInstanceOf(DuplicateDealError);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter app test -- useCreateDeal`
Expected: FAIL. The place_id assertions fail (payload has no `place_id`), and `DuplicateDealError` is undefined (import + class not defined yet).

- [ ] **Step 3: Implement place_id + DuplicateDealError**

In `useCreateDeal.ts`:

(a) Add the field to `CreateDealInput` (after `professionData?...`, still inside the interface):

```ts
  professionData?: Record<string, unknown>;
  /** Google place_id of the source prospect. Present for deals created from Path
   *  discovery; null for manually-entered deals. Anchors org-wide de-duplication. */
  placeId?: string;
```

(b) Add `place_id` to the insert object (after the `profession_data:` line, inside `.insert({ ... })`):

```ts
          profession_data:     input.professionData ?? {},
          place_id:            input.placeId ?? null,
```

(c) Replace the current error check `if (error) throw error;` with:

```ts
      if (error) {
        // Postgres unique_violation from deals_org_place_active_uidx: this
        // business is already an ACTIVE deal somewhere in the org. Surface a
        // typed error so callers can show a calm "already in pipeline" message.
        if ((error as { code?: string }).code === "23505") {
          throw new DuplicateDealError();
        }
        throw error;
      }
```

(d) Add the exported class near the top of the file, right after the imports (above `export interface CreateDealInput`):

```ts
/**
 * Thrown by useCreateDeal when the deals_org_place_active_uidx partial unique
 * index rejects the insert, i.e. an ACTIVE deal for this place_id already exists
 * in the org. Callers catch this to show a friendly de-dupe message instead of a
 * raw database error.
 */
export class DuplicateDealError extends Error {
  constructor() {
    super("This business is already in your team's pipeline.");
    this.name = "DuplicateDealError";
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter app test -- useCreateDeal`
Expected: PASS (all tests in the file, including the three new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/pipeline/hooks/useCreateDeal.ts apps/app/src/features/pipeline/hooks/useCreateDeal.test.tsx
git commit -m "feat(pipeline): stamp place_id on deals + DuplicateDealError on unique violation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: DropInSheet - thread place_id + calm duplicate message

**Files:**
- Modify: `apps/app/src/features/path/components/DropInSheet.tsx`
- Test: `apps/app/src/features/path/components/DropInSheet.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `DropInSheet.test.tsx`:

(a) Make the sonner mock expose `info` (it currently only stubs `success` and `error`). Change:

```ts
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
```

to:

```ts
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
```

(b) The `useCreateDeal` mock must also export a `DuplicateDealError` whose identity matches the one `DropInSheet` imports (the component imports it from the same mocked module, so exporting it here makes `instanceof` work). Use `vi.hoisted` so the class exists when the hoisted `vi.mock` factory runs. Change:

```ts
vi.mock("@/features/pipeline/hooks/useCreateDeal", () => ({
  useCreateDeal: () => ({ mutateAsync: createDealMutateAsync }),
}));
```

to:

```ts
const { DuplicateDealError } = vi.hoisted(() => {
  class DuplicateDealError extends Error {
    constructor() {
      super("dup");
      this.name = "DuplicateDealError";
    }
  }
  return { DuplicateDealError };
});
vi.mock("@/features/pipeline/hooks/useCreateDeal", () => ({
  useCreateDeal: () => ({ mutateAsync: createDealMutateAsync }),
  DuplicateDealError,
}));
```

(c) Give the `merchant` test fixture a `placeId`. Add `placeId: "gp-blue-1",` to the fixture object (the block that ends around `status: "untouched", lastActivity: null`).

(d) Extend the existing "creates deal + activity" test to assert place_id is threaded. In the `it("follow-up disposition + Log Stop creates deal + activity ...")` test, change the createDeal assertion to include placeId:

```ts
    expect(createDealMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        contactName: "Bluewater",
        leadSource: "path_dropin",
        placeId: "gp-blue-1",
      }),
    );
```

(e) Add a new test for the duplicate path:

```ts
  it("on a duplicate (DuplicateDealError): info toast, no error toast, no markDealCreated", async () => {
    createDealMutateAsync.mockRejectedValueOnce(new DuplicateDealError());
    const onLogged = vi.fn();
    renderSheet({ onLogged });
    fireEvent.click(screen.getByText("Statement Secured"));
    await act(async () => { fireEvent.click(logStopBtn()); });
    // Visit is still recorded; no duplicate deal, and it reads as info not error.
    expect(logVisit).toHaveBeenCalledWith("m-1", "statement_secured");
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining("already in your team's pipeline"),
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(markDealCreated).not.toHaveBeenCalled();
    expect(onLogged).toHaveBeenCalledWith("statement_secured");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter app test -- DropInSheet`
Expected: FAIL. The placeId assertion fails (not threaded yet), and the duplicate-path test fails (catch still shows a generic error toast, and `toast.info` is not called).

- [ ] **Step 3: Implement the thread + the branch**

In `DropInSheet.tsx`:

(a) Add `DuplicateDealError` to the useCreateDeal import. Change:

```ts
import { useCreateDeal } from "@/features/pipeline/hooks/useCreateDeal";
```

to:

```ts
import { useCreateDeal, DuplicateDealError } from "@/features/pipeline/hooks/useCreateDeal";
```

(If the existing import path differs, add `DuplicateDealError` to whatever the existing `useCreateDeal` import statement is.)

(b) Pass the prospect fingerprint into the create call. In the `createDeal.mutateAsync({ ... })` object add `placeId: merchant.placeId,`:

```ts
        const { id: dealId } = await createDeal.mutateAsync({
          companyName: merchant.name,
          address: merchant.address,
          industry: merchant.category,
          contactName: merchant.name,
          contactPhone: merchant.phone ?? "",
          stage: "new",
          probability: 20,
          leadSource: "path_dropin",
          notes: notes.trim() || undefined,
          placeId: merchant.placeId,
        });
```

(c) Replace the current `} catch {` block (the one that shows "Couldn't finish logging ...") with a binding that branches on the duplicate case:

```ts
      } catch (err) {
        if (err instanceof DuplicateDealError) {
          // Already in the team's pipeline (org-wide active-deal guard). The
          // visit above is still recorded; we simply skip creating a duplicate
          // deal and tell the rep calmly rather than flashing an error.
          toast.info(`${merchant.name} is already in your team's pipeline.`);
        } else {
          toast.error("Couldn't finish logging — the visit was saved but the deal/follow-up may not have been.");
        }
      }
```

Note: the em dash inside that existing error string is pre-existing; leave the string byte-for-byte as it already is in the file (do not introduce new dashes elsewhere).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter app test -- DropInSheet`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/path/components/DropInSheet.tsx apps/app/src/features/path/components/DropInSheet.test.tsx
git commit -m "feat(path): thread place_id into drop-in deals + calm duplicate message

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Full suite, typecheck, push, deploy handoff

**Files:** none (verification + handoff)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm --filter app test`
Expected: PASS, no regressions (baseline was 1850 green).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter app typecheck`
Expected: no errors.

- [ ] **Step 3: Push to main**

```bash
git push origin HEAD:main
```

- [ ] **Step 4: Hand the user the migration SQL + verification steps**

Prod migrations are applied by pasting SQL into the Supabase SQL editor (not `supabase db push`). Give the user:
1. The full contents of `supabase/migrations/20260724000001_pipeline_place_id_dedupe.sql` to paste and run.
2. The verification queries from Task 1 Step 3, in plain language: confirm the column + two indexes exist; confirm a second active deal with the same place_id is rejected; confirm a won/lost deal does not block; confirm a discovered prospect with an active deal disappears from Path search and returns once the deal is marked lost.

Note the ordering: the frontend push (Step 3) is safe to ship before the migration because `useCreateDeal` inserting `place_id` only takes effect once the column exists; until then the column is simply absent. Confirm with the user whether they want to apply the migration first or the push first, and recommend applying the migration first so the very first drop-in after deploy already stamps place_id.
```
