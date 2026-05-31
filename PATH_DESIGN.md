# Path / Build Your Path — Design Doc

**Status:** Design (no code yet)
**Date:** 2026-05-31
**Author:** brainstormed via office-hours, ceo@outsidehire.com
**Scope decision:** Full FR-PATH-01→20 vision (not a minimal cut)
**Spec source:** navigatr_PRD (3).docx §6.5

---

## 1. What this is

Path is navigatr's field-prospecting loop: a rep opens the app, taps **Create Path**,
and gets 25-30 real, in-profile businesses near them, ordered into a walkable/drivable
route. They drive to one, log a **Drop-In** with a disposition, and that visit auto-creates
a deal + follow-up task + note. The other mode, **Find Near Me**, is the same data with
rep-driven individual selection instead of an auto-built route.

This is the core value prop of the field-sales product. Today it's faked: `useMerchants.ts`
derives "merchants" from the rep's existing deals with `lat/lng = NaN`, so the map shows
nothing and there's no real prospecting infrastructure. Everything below is greenfield.

## 2. The decision that shapes everything: cost

Google Places **Nearby Search** ≈ $32/1k calls; **Place Details** ≈ $17/1k *per place*.
One path that surfaces 25 ICP-passing businesses needs ~60-80 raw results (most get filtered
out) + a Details call on each survivor ≈ **$0.45/path built**.

At scale (5 ISOs × up to 2,000 reps = 10,000 reps; assume 3,000 active × 2 paths/day):
**~6,000 paths/day × $0.45 ≈ $2,700/day ≈ $80K/month** in Places fees alone — if we call
Places live on every build.

**Therefore the architecture is "don't call Places most of the time."** We maintain our own
cached geospatial prospect store; Places only backfills cold geography. This is the single
most important design choice and it cuts Places spend ~90% while making path builds sub-second.

## 3. Approaches considered

### A — Live Places passthrough (rejected)
Every build calls Places live, filters in an Edge Function, returns. Simplest, always fresh.
Rejected: ~$80K/mo at scale, 1-3s latency per build, no place to apply consistent
ICP/exclusion logic, no shared benefit across reps.

### B — Cached geospatial store (CHOSEN)
A platform-wide PostGIS `prospects` table keyed by geo cell + category. Path queries OUR DB
first; Places is called only to backfill cold cells, and results are cached for every rep
nearby across all tenants. ICP + exclusion evaluated at ingest. ~90% spend cut, sub-second
builds, data compounds as the map fills in.

### C — Hybrid cache + scheduled live refresh (chosen as the eventual shape)
Approach B plus a background job that re-pulls a cell when its cached data ages past N days.
This is where B naturally grows; we ship B with a `last_refreshed_at` column so the refresh
job slots in without a rewrite.

**Decision: build B, schema-ready for C.**

## 4. Data model

### 4.1 Two kinds of data, two tenancy rules

1. **The business (shared, platform-owned).** A coffee shop at 123 Main St is the same
   business for every ISO. Ingested from Places **once** into a global table; every tenant's
   reps benefit. New tenants get a warm map on day one. This is what makes the cache pay off.

2. **The verdict ("good lead?") — layered, tenant-aware.** Computed as:
   **global seed → profession defaults → per-tenant overrides.**
   - **Global seed list (navigatr-curated, fed to all tenants):** ~500 national/regional
     chains, maintained centrally once, pushed to everyone. New accounts inherit it.
   - **Per-profession defaults (FR-PATH-15):** category rules per Payroll / Merchant Services
     / Treasury. Platform-owned, shared.
   - **Per-tenant overrides (FR-PATH-13/16/19):** each ISO admin adds/removes entries and
     disables specific rules *for their reps only*. Never leak across tenants.

   Raw data shared; filtering verdict computed per (tenant, profession).

### 4.2 Tables (sketch)

```
prospects                      -- shared, platform-owned
  id              uuid pk
  place_id        text unique  -- Google Place ID (dedupe key)
  name            text
  category        text         -- normalized Places type
  location        geography(Point,4326)   -- PostGIS, GIST-indexed
  geo_cell        text         -- H3 or geohash, for cell-level cache bookkeeping
  address         text
  phone           text
  website         text
  rating_count    int          -- proxy signal (Places user_ratings_total)
  employee_count  int null     -- VENDOR-GATED, null at launch
  source          text         -- 'google_places'
  last_refreshed_at timestamptz -- enables Approach C refresh job
  created_at      timestamptz

prospect_classification        -- shared chain/enterprise verdict, recomputed on rule change
  prospect_id     uuid fk
  is_chain        bool
  chain_reason    text         -- 'seed_list' | 'same_name_density' | 'category' | 'gov'
  classified_at   timestamptz

geo_cell_cache                 -- cold-cell bookkeeping: did we already pull this cell?
  geo_cell        text
  category        text
  last_pulled_at  timestamptz
  raw_count       int          -- FR-PATH-17 observability
  filtered_count  int
  pk (geo_cell, category)

exclusion_seed                 -- global, navigatr-curated, fed to all tenants
  id, name_pattern, brand, scope ('national'|'regional'), region, active

profession_category_rules      -- global per-profession ICP category allow/deny
  profession, category, allowed bool

tenant_targeting_overrides     -- per-tenant (FR-PATH-13/16/19)
  org_id, rule_type, value, action ('exclude'|'include'|'disable_rule'), created_by

tenant_exclusion_requests      -- admin review queue (FR-PATH-13, 24h SLA)
  org_id, prospect_id|brand, requested_by, status, resolved_at

path_records                   -- a built path
  id, org_id, rep_id, origin geography, created_at, mode ('create'|'find_near_me')

path_stops                     -- ordered stops
  path_id, prospect_id, seq, distance_m

drop_ins                       -- FR-PATH-07/08/09 logged visit
  id, org_id, rep_id, prospect_id, path_id null,
  disposition text,            -- one of 10 color-coded outcomes
  note text, deal_id uuid fk, task_id uuid fk, created_at
```

Notes:
- `place_id unique` is the cross-tenant dedupe: ingest once, reuse everywhere.
- No `claimed_by` / suppression for MVP (decision below). Schema leaves room to add it.
- `employee_count` nullable — Google does not return it (see §6).

## 5. Filtering pipeline (FR-PATH-11→20)

Runs **server-side, at ingest** (when a cell is backfilled), not per request. Reps cannot
override (FR-PATH-19). What gets *pulled* before this pipeline runs is set by the categorized
ingest in §11 (per-category `searchNearby`, 7 buckets) — that's what surfaces service
businesses the single popularity pull misses. Order:

1. **Category gate (FR-PATH-15):** drop consumer-only (residential, lodging, tourist, worship,
   schools); keep per-profession allowed categories.
2. **Global seed match (FR-PATH-12):** name/brand against `exclusion_seed` → `is_chain`.
3. **Same-name density heuristic (FR-PATH-14):** >10 same-name within 100mi radius → chain.
   This is what catches *unknown/regional* chains the seed list misses, using data the cache
   already has. No external cost.
4. **Gov/military/utility/major-hospital category drop (FR-PATH-14).**
5. **Employee count >250 (FR-PATH-14):** VENDOR-GATED, off by default at launch (no source).
6. **Per-tenant overrides applied at query time (FR-PATH-13/16/19).**
7. **Observability (FR-PATH-17):** record total returned, filtered count, per-record reason
   code in `geo_cell_cache` / `prospect_classification`, surfaced to admins.
8. **Auto-widen (FR-PATH-18):** if <10 in-profile after filtering, widen radius up to
   configurable max (default 25mi), re-query cache, backfill if still cold.

Filtering thresholds + category exclusions live in Settings → new **Prospect Targeting**
panel (FR-PATH-16), sensible defaults, works out of the box.

## 6. Known data gaps / caveats

- **Employee count: Google Places does not return it.** FR-PATH-04 (show on card) and
  FR-PATH-14 (>250 filter) both depend on data we don't have from Places. MVP: drop employee
  count from the card OR show a rough proxy from category + `rating_count`; make >250 a
  vendor-gated rule that's off by default. Real fix is a firmographics vendor (fast-follow).
- **Exclusion list completeness:** seed + heuristics catch the high-volume and unknown-chain
  cases; the disguised "local name, public parent" case needs a vendor. The admin review queue
  (24h SLA) is the learning loop that closes the long tail until/if a vendor is added.

### 6.1 B2B coverage gap (decided: Places-only for MVP)

Google Places is a *consumer discovery* index. It is strong for retail/local (storefronts,
restaurants, dentists, auto shops) and weak-to-blind for B2B — exactly the high-value targets
for merchant services / payroll / treasury reps. Three failure modes:

1. **Absent:** a 60-person B2B firm in an office park often has no useful Places presence.
2. **Building-level not suite-level:** Places gives one pin for a tower; the 40 businesses
   inside it are invisible.
3. **Coarse categories:** Places types are retail-shaped; B2B NAICS/SIC categories don't map,
   so the ICP filter has poor signal for B2B. (Same root cause as the employee-count gap.)

The *in-Places* slice of failure mode 3 — service businesses that Places carries but the single
popularity pull never surfaces — is addressed by **categorized ingest (§11)**. That does not
fix absent/building-level B2B (modes 1-2); those still need the firmographics vendor (§6.1
above / Phase 5).

**Decision:** **Places-only for MVP.** No firmographics vendor as a launch dependency. We prove
the rep loop (build → drive → log → auto-deal) first. Accepted consequence: **MVP Path skews
retail/local**; office-park / multi-tenant / industrial prospecting will be thin and B2B ICP
filtering weak. Launch ISOs should be told Path's first cut is strongest for storefront work.

**Designed so this is not a rewrite later:**
- The `prospects.source` column keeps the store source-agnostic. A firmographics dataset
  (Data Axle / D&B / Melissa class — ~16M US businesses, NAICS-coded, geocoded to suite,
  with employee count + revenue) loads into the **same table** post-launch and Path merges it
  transparently. This is the primary B2B coverage upgrade, not just employee-count enrichment.
  Cost model fits the cache: license a regional bulk slice and load it periodically — not
  per-request.
- **Rep-contributed prospects** stays on the roadmap as the cheapest B2B gap-filler: a Drop-In
  on a business not in the cache creates a prospect record, so the field force fills coverage
  in the territories they actually work. Not in MVP; deliberate later choice.

## 7. Exclusion sourcing decision

Layered hybrid (per §4.1): **global curated seed + free heuristics + per-tenant admin queue**,
with the prospect schema designed so a **firmographics vendor enrichment step slots in later
without a rewrite** (fills `employee_count`, adds `parent_company`/public-status signal). No
vendor dependency to launch; vendor is a planned phase-2 upgrade, not a launch blocker.

## 8. Lead claiming decision (MVP)

**Show everything, no within-tenant suppression for MVP.** Every rep sees every in-profile
prospect regardless of teammates' activity. Accepted risk: two same-tenant reps could walk the
same shop the same week. Mitigation deferred — `drop_ins` and `path_stops` carry enough to
layer a cooldown/claiming toggle later without migration pain. Revisit when any launch ISO has
dense rep coverage in one metro.

## 9. Build sequence

**Phase 1 — Prospect store + ingest (backend spine)**
- PostGIS `prospects` + `geo_cell_cache`, GIST index, place_id dedupe.
- Places backfill Edge Function: cold-cell detection → Nearby Search → Place Details on
  survivors → upsert. Quota guards + per-cell cooldown.
- Category gate + seed-list + same-name-density classifier at ingest.

**Phase 2 — Path build + map (the rep loop)**
- Replace `useMerchants.ts` (deals-derived, NaN coords) with a real query over `prospects`
  ordered by proximity from rep origin (FR-PATH-02/03).
- Wire `MerchantMap` to real coords; `MerchantList` sorted by distance.
- Create Path (auto 25-30 + route summary nearest/furthest + numbered stops, FR-PATH-01/06)
  and Find Near Me (FR-PATH-20).
- Card: address, contact, est. value, one-click call/email, launch Google Maps turn-by-turn
  (FR-PATH-04/05). Employee count per §6.

**Phase 2.5 — Categorized ingest (BUILT, fixes service-business coverage)**
- Per-category `searchNearby` (7 buckets, `POPULARITY`), one shared taxonomy driving both
  ingest targeting and `categoryFromPlaces`, per-bucket cell warmth. Full spec in §11.

**Phase 3 — Drop-In → auto-deal (the conversion)**
- Log Drop-In from a Path record (FR-PATH-07), 10 color-coded dispositions auto-save
  (FR-PATH-08).
- Auto-create deal + follow-up task + timestamped note (FR-PATH-09).
- Speech-to-text notes (FR-PATH-10).

**Phase 4 — Admin controls + observability**
- Settings → Prospect Targeting panel (FR-PATH-16): thresholds, category exclusions.
- Tenant override CRUD + exclusion review queue w/ 24h re-run (FR-PATH-13/19).
- Observability surfaces: total/filtered/reason codes to admins (FR-PATH-17).
- Auto-widen radius logic (FR-PATH-18).

**Phase 5 (fast-follow, post-launch)**
- **Firmographics vendor as a second ingest source (PRIMARY B2B coverage upgrade, §6.1)** —
  not just employee-count enrichment; this is what makes Path work for office-park / B2B
  prospecting. Loads into the same `prospects` table via the `source` column.
- Rep-contributed prospects (§6.1) — cheapest B2B gap-filler, Drop-In on unknown business.
- Scheduled cache refresh job (Approach C).
- Within-tenant lead-claiming toggle (§8).

## 10. Open questions for next session

- Route optimization depth: simple proximity nearest-neighbor (cheap, FR-PATH-02 literal) vs
  a real TSP-ish solver. MVP = nearest-neighbor greedy; revisit if reps complain about routes.
- "Estimated value" on the card (FR-PATH-04): what's the formula? Category + size heuristic?
- Geocoding rep origin: device GPS (useGeolocation hook exists) — confirm permission UX.
- Places quota ceiling + billing alerts before Phase 1 ships (cost guardrail).
- Vendor shortlist for Phase 5 (PDL / Clearbit / other) + per-record cost vs cache model.

## 11. Categorized ingest (chosen — fixes the service-business gap)

**Status:** BUILT (Phase 2.5). Shipped as `_shared/categoryTaxonomy.ts` (7-bucket
`{bucket → Table A types}` map + `bucketForType`), per-bucket parallel pulls in
`discover_prospects/index.ts` (`fetchPlacesByCategory`, `rankPreference: "POPULARITY"`),
per-bucket `geo_cell_cache` warmth, and `categoryFromPlaces` reduced to an enum guard.
Decisions below are the as-built spec.

**Problem.** Phase 1 ingest issues a single category-agnostic `searchNearby`
(`discover_prospects/index.ts:92`) with `maxResultCount: 20` and no `includedTypes`.
Google returns the 20 most *prominent* places in the circle — which skews to restaurants,
retail, hotels, landmarks. Low-prominence service businesses (plumbers, accountants, movers,
contractors, B2B services) almost never crack the top 20, so they're not *filtered* out —
they're never pulled. A live audit of the in-app bucketing (`categoryFromPlaces`) confirmed
the same gap downstream: 17 of 93 common service types fall to `"other"`, and a substring bug
mis-bucketed `barber_shop` → restaurant (the `bar` rule ate `bar`ber). This is the in-Places
slice of the §6.1 coverage gap, and it's fixable without a vendor.

**Decision — per-category pulls.** On a cold cell, issue **one `searchNearby` per ICP category
bucket**, each with its own `includedTypes`, so every category gets a dedicated 20 slots and
services stop competing against prominent restaurants.

- **Granularity: 7 buckets** — food, retail, automotive, healthcare, personal services,
  professional services, hospitality. (Each maps to a UI filter chip.)
- **Rank: `POPULARITY`** — pulls the most-established businesses per type. The read path
  (`prospects_nearby`) re-sorts by distance anyway, so the rep still sees nearest-first, seeded
  from higher-quality prospects.
- Fire the 7 pulls with `Promise.all` so a cold cell stays ~2-3s, not 7× serial.

**One taxonomy, both gates.** Extract a single `{ ourCategory → googleTypes[] }` map into
`_shared`. It drives *both* the ingest `includedTypes` *and* a rewrite of `categoryFromPlaces`
(replacing the brittle substring rules). This kills the `bar`/`barber` class of bug and the
`"other"` dumping in the same move, and guarantees ingest targeting and display labels can
never drift apart.

**No schema change.** `geo_cell_cache` is already keyed `(geo_cell, category)`
(migration `20260531000001:122`); the `category = "_all"` sentinel was the Phase-1 placeholder.
Switch to **per-bucket warmth**: read all cache rows for the cell, pull only cold/expired
buckets, mark each. Adding a category later backfills just that bucket; a partial failure
re-pulls only what's missing. Existing `_all` rows go stale and are ignored (or cleared so
cells re-pull cleanly). `prospects` dedupes on `place_id` (upsert `onConflict: place_id`), so a
business returned by two buckets collapses to one row — no duplicates.

**Cost.** Field mask includes phone + website → Enterprise SKU ≈ **$0.035/call**.
1 → 7 calls per *cold* cell = **~$0.035 → ~$0.25**, once per area per 30-day TTL. For ~5 ISOs
on a metro this is a few dollars/month; the shared 30-day cache is what makes 7× the calls a
rounding error (the whole §2 cost thesis still holds).

**Risks / guards.**
- Invalid `includedTypes` value 400s the call → unit-test the map against Google Table A.
- Same-name density (`index.ts:192-204`) must count over the *combined* batch + existing cache,
  not per-pull, or a chain split across buckets could slip the heuristic.
- Cold-cell latency → parallelize (above).

**Build sequence.**
1. Extract `{ourCategory → googleTypes[]}` taxonomy into `_shared`.
2. Rewrite `categoryFromPlaces` on top of it (absorbs the "Fix A" relabel + barber bug).
3. `fetchPlaces` → `fetchPlacesByCategory`, parallel pulls with `includedTypes`, `POPULARITY`.
4. Per-bucket cache check + marking in the cold-cell block.
5. Tests: taxonomy validity vs Table A, cold-issues-7-calls / warm-skips, density across buckets.

---

## Handoff

This doc is the spec. Recommended next step: take **Phase 1** into a feature-design /
architecture session (the prospect store + Places backfill Edge Function is the spine
everything else hangs off). Do not start Phase 2 UI until Phase 1 returns real coords —
that's what unblocks `MerchantMap` and kills the NaN placeholder in `useMerchants.ts`.
