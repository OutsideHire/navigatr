# Path feature — session handoff (2026-06-03)

Single resume doc for the Path prospect-discovery feature. Read this first, then
the per-slice specs/plans in `docs/superpowers/specs/` + `docs/superpowers/plans/`.

## Path v3 — path-first redesign (IN PROGRESS, 2026-06-03)

Reworking the Path page from discovery-first to **path-first**: a two-card entry
(Create a Path / Plan a Path), the active path as the home view, and durable
multi-day planning. Spec: `docs/superpowers/specs/2026-06-03-path-v3-path-first-redesign-design.md`.
Locked decisions live there (server-backed paths, one-per-day, Create=GPS auto-build→today,
Plan=hand-pick→a chosen day, list-first home, discovery demoted to "Add stops").

Build phases: **1a data foundation (DONE)** → 1b path-first UI (NEXT) → 2 multi-day → 3 running mode.

**Phase 1a — SHIPPED to main (2026-06-03).** Plan:
`docs/superpowers/plans/2026-06-03-path-v3-phase-1a-data-foundation.md`.
- New tables `paths` + `path_stops` (owner RLS, 8 policies) — **migration
  `20260603000001` applied to prod by hand** (`supabase db query --linked -f`, not push).
  `path_stops` snapshots display fields (name/address/lat/lng/category/primary_type) so a
  path renders without joining the volatile `prospects` cache.
- New hooks in `apps/app/src/features/path/`: `lib/pathTypes.ts`, `hooks/usePaths.ts`,
  `hooks/useActivePath.ts`, `hooks/usePathMutations.ts` (create/add/remove/reorder/
  status/disposition/deal). `addStops` dedupes via `upsert(ignoreDuplicates)`.
- **Dormant** — nothing imports these yet; `usePathQueue` still drives the live UI.

**Phase 1b — NEXT (not built).** Path-first UI: `PathEntry` (two cards),
`ActivePathView` (list-first home), discovery demoted to an "Add stops" view,
Create/Plan wired to write into a path, and the **one-time local-queue →
today's-path migration** (needs loaded merchant details for the snapshot, which
is why it's in 1b not 1a). Carry-forwards: live-smoke the `usePaths`
`path_stops(count)` embedded-count shape on first real call; add tests for the
remove/reorder/status/disposition mutations. Build with `frontend-design`, verify
with `/design-review`.

## TL;DR — Slice 5 DEPLOYED (2026-06-02)

**Slice 5 is now live.** Migration + Edge deployed and verified at the contract
level on `ogvcveimjjeywfdkkinb`:
- Migration applied via `supabase db query --linked -f supabase/migrations/20260601000003_chain_handling.sql`
  (NOT `db push` — migration history left out of sync on purpose, as before).
- `discover_prospects` Edge redeployed (migration-first, so the old 5-arg
  `prospects_nearby` was already gone before the Edge began sending
  `p_include_chains`).
- Verified: `prospects.chain_confidence/chain_brand_id/chain_brand_name` +
  `exclusion_seed.brand_id/primary_type` present; allowlist = 300 branded
  patterns; `prospects_nearby` 6-arg signature live. RPC at a live Austin cluster
  returns 0 chains with `p_include_chains=false` (Create) and includes chains
  with `=true` (browse).

**Only remaining check (low priority):** confirm *fresh ingest* populates
`chain_confidence`/`chain_brand_name` — happens naturally on TTL re-pull as reps
browse `/path` (existing rows show `chain_confidence=null` until their cell
re-fills). No cache wipe needed; left to natural UI usage to avoid Google Places
cold-fill spend.

The reusable apply pattern for future hand-migrations (no `db push`):
`supabase db query --linked -f <migration.sql>`.

## Location handling — SHIPPED (2026-06-02)

Replaced the Path map's downtown-Austin default with honest location handling
(specs/plans: `docs/superpowers/{specs,plans}/2026-06-02-path-location-handling.*`
and `...-path-blocked-location-recovery.*`). All merged to `main` and deployed.
What changed:
- `useGeolocation` returns `coords | null` + `status` (loading/ready/denied/
  unavailable) — never fabricates Austin (`AUSTIN_DOWNTOWN` deleted). Watches the
  Permissions API and auto-re-requests GPS when the user re-enables location
  (no click/reload; best-effort, degrades on older Safari).
- `usePathOrigin` resolves origin = manual (session-only city/ZIP search) >
  GPS-when-ready > null. `LocationSearch` (submit-based, autoFocus). `PathPage`
  renders by origin state; the no-origin empty state splits into a search-first
  **blocked** card (denied — `<details>` how-to, no dead button) and a **Try
  again** card (unavailable).
- Server-side `geocode` Edge fn (`supabase/functions/geocode/`) reuses
  `GOOGLE_PLACES_API_KEY`; client calls it via `supabase.functions.invoke`.

**All deploy steps DONE:**
- ✅ Geocoding API enabled on the Google Cloud project (owner, 2026-06-02).
- ✅ `geocode` Edge deployed: `supabase functions deploy geocode --project-ref ogvcveimjjeywfdkkinb`.
- ✅ Frontend on Vercel (deploys on push to `main`).
- ✅ **Permissions-Policy fix** in `apps/app/vercel.json`: `geolocation=()` →
  `geolocation=(self)`. The blanket `()` had disabled the Geolocation API
  site-wide — that was the original cause of the Austin fallback AND would have
  forced everyone onto manual-search-only. If GPS ever silently stops working on
  the deployed site, check this header first.

Known browser gotchas when testing on the deployed site: it's a PWA (service
worker caches the bundle — hard-refresh / incognito after a deploy), and a
previously-blocked location permission stays sticky (the blocked-state UI now
steers to search + auto-recovers when the user re-enables).

Prod project ref: `ogvcveimjjeywfdkkinb` (Navigatr). Deployed at
`https://navigatr-app.vercel.app`.

## What shipped (all merged to main)

| Slice | PR | What | Backend deployed? |
|---|---|---|---|
| 1 — discovery + ranking | #53 | radius 5/10/15mi drives ingest, sort tabs (distance/opportunity/popularity), `primary_type`, MAX_CELLS→130 | ✅ migration + Edge live |
| 2 — guided Create + summary | #54 | Create wizard (filters → route preview → start), completion summary, `routeStats`/`proposeRoute` utils | frontend only |
| 3 — drop-in logging | #55 | field disposition tiles → engaged outcomes create a Pipeline deal + follow-up; completion-summary breakdown | ✅ migration live |
| wizard fixes | #56 | multi-select industries + free-entry max-stops | frontend only |
| 4 — taxonomy | #57 | 13-industry taxonomy + B2B tiers replace the 8 buckets; industry-scoped ingest (default Tier 1, All=Tier1+2) | ✅ migration + Edge live |
| 5 — chain handling | #58 | chain confidence + brand attribution, 300-pattern allowlist, show+flag chains in browse, Create stays chain-free | ✅ migration + Edge live (2026-06-02) |

Earlier foundation (pre-this-session, also on main): Phase 1 prospect store +
`discover_prospects` Edge + ICP filter; Phase 2/2.5 categorized ingest; MapLibre
map migration with the exact brand palette (cream land / light-blue water /
near-white roads / gray labels via `_shared`-driven custom style).

## Key locked decisions (the "why")

- **Opportunity ranking:** ingest by DISTANCE (not POPULARITY) so underseen/
  newly-opened businesses get fetched; re-rank in-app by `opportunityScore`
  (`1/(1+reviews)`). Popular = a competitor already got there.
- **Enrichment is OUT of MVP:** employee count, estimated deal value, and email
  aren't in Google Places → cut everywhere (no min-employee filter, no Value
  sort, no $ totals, no email action). Anything the workbook gates on a
  min-employee filter is therefore noisier than its ideal until enrichment lands.
- **Radius drives the ingest** (not just a client filter); 5/10/15mi; MAX_CELLS
  130 so a 15mi pull isn't truncated at US latitudes (~$32 worst-case cold-fill).
- **Hybrid workflow:** keep the single-page browse as "Find near me"; add a
  guided "Create path" wizard + a completion summary. No separate mode-picker
  screen (redundant under hybrid).
- **Drop-in → deal:** only ENGAGED dispositions (met_dm, gatekeeper,
  left_collateral, scheduled_callback) create a Pipeline deal + follow-up; the
  rest just record the visit. `deals.contact_email`/`value_cents` relaxed to
  nullable for field-sourced deals. Deals-created counts ACTUAL creation (a
  `dealCreated` flag on the queue stop), not the disposition, so a failed save
  can't over-count.
- **13-industry taxonomy** (authoritative workbook `places_api_taxonomy_path_feature.xlsx`):
  unified config in `supabase/functions/_shared/industryTaxonomy.ts` (Deno + FE
  share it; `tsconfig.app.json` includes that one Deno-free file). `MerchantCategory`
  is path-local (deals use free-text `industry`), so taxonomy changes don't touch
  Pipeline. Reconciliation rules: global hard-exclude (B2B Exclude families +
  Table A Exclude types + Table B types never in `includedTypes`); explicit
  industry pick wins over Table A Exclude (so Education fetches schools).
- **B2B tiering:** default fetch = Tier 1 (Manufacturing/Construction/Healthcare/
  Professional Services/Automotive); "All" = Tier 1+2; Tier 3 + Exclude families
  never fetched. Recovered the previously-missing Tier-1 core (manufacturer,
  supplier, corporate_office).
- **Chain handling (Slice 5):** detection order = allowlist→high (with brand_id/
  name), enterprise→high, name-frequency ≥25→medium, place-type tiebreak
  (chain-prone primary type + same-name in [12,25))→medium; place-type alone
  never flags. Browse sends `include_chains:true` (shows + "Chain · {brand}"
  badge, muted `priority-low` Badge kind); a "Hide chains" toggle (default off)
  filters client-side; Create stays chain-free because `proposeRoute` drops
  `isChain`. Manual "Add to today's path" of a badged chain IS allowed by design
  (rep's call) — confirm if you want to block it.

## Architecture quick-map

- Ingest: `supabase/functions/discover_prospects/index.ts` (Deno) — geohash-cell
  tiling, per-(cell, industry) cache in `geo_cell_cache`, ICP classify, upsert to
  `prospects`. No local Deno typecheck — verifies on deploy.
- Pure cross-runtime `_shared/*.ts` (Deno-import with `.ts`, vitest without):
  `industryTaxonomy.ts`, `icpFilter.ts`, `geohash.ts`.
- Read: `prospects_nearby` RPC (SECURITY DEFINER, ST_DWithin, distance-ordered,
  now with `p_include_chains`). The Edge calls it via the user JWT.
- Frontend (`apps/app/src/features/path/`): `useMerchants` (TanStack Query →
  Edge), `mockData.ts` (Merchant type + CATEGORY_LABEL), `pages/PathPage.tsx`,
  `components/` (MerchantMap [MapLibre], MerchantList, MerchantDetailSheet,
  PathPlanSheet, CreatePathWizard, DropInSheet, PathSummary), `hooks/usePathQueue`
  (zustand persist), `lib/` (sortMerchants, routeStats, proposeRoute,
  pathDispositions).
- Test gate: `cd apps/app && pnpm typecheck && pnpm test` (497 at handoff). The
  "kaboom from Bomb" stderr is an intentional RouteErrorBoundary test.

## Deferred backlog (not built)

- **Slice 5 follow-ups:** website-domain chain detection (territory background
  job), manual rep override / feedback endpoint (`user_chain_override`),
  franchisee-targeting mode (needs enrichment).
- **Firmographic enrichment** (D&B/ZoomInfo/Apollo/Clearbit): employee count,
  estimated value, email → unlocks the min-employee filter, Value/Employees sort
  tabs, $ pipeline totals, email action, the >250-employee ICP gate.
- **Territory mode:** town/corridor-scoped ingest for 30–60mi rural reps
  (`cellsCoveringRoute` primitive). The office-hours design doc has a standing
  assignment: ride along with ONE rural + ONE urban rep before building it, to
  pin down the real "already has a processor?" opportunity signal.
- **Real drive-time routing** (Google Routes/Distance Matrix) — today ETA is a
  crude straight-line estimate. **Voice notes** in the drop-in sheet.

## Working conventions (this session)

- Branch per slice off `main`; subagent-driven execution (implementer per task
  group + two-stage review + a final branch review); squash-merge PRs; delete the
  branch after.
- Migrations applied by hand in the Supabase SQL editor (NOT CLI db push).
- Commit trailer used: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- `docs/` is gitignored — specs/plans/this handoff live on disk only.
