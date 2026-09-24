# Discovery filtering: home-based and large-corporate businesses

Status: approved design, not yet implemented
Date: 2026-09-25

## The problem

Elavon (beta ISO) reports that Path discovery returns businesses their reps
cannot actually work:

> "it's currently about 70% of the businesses that show up in my local area, and
> reps are reporting 50-70% of theirs are residential as well. The other thing
> brought to my attention today is that large corporate businesses are also
> mapping in: The likes of Home Depot, Ace Hardware, multiple fast food places,
> etc. Curious if when they create blocks on some residential if they can do the
> same with large corporate/commercial?"

Note the ask: the customer is asking US to block these centrally, not asking for
a self-serve blocking tool. That reading is what keeps this scoped.

## What we verified against production

Both halves of the complaint were checked against the live `prospects` table
before designing anything. The results split the ask in two.

**Chains: the filter works. The complaint is largely a false alarm.**
Every Home Depot and Ace Hardware row on production is correctly flagged
(`is_chain = true`, `chain_reason = seed_list`), and the read path excludes
them. A sweep of major brands (McDonalds, Subway, Starbucks, Dollar General,
Walgreens, 7-Eleven, Taco Bell, Dominos, Pizza Hut, Tractor Supply, Ace
Hardware) found exactly ONE escape:

    brand      | escaped
    True Value | 18

True Value is a co-op whose member stores trade under local names
("Adam True Value Hardware & Ag Sply"), which the substring block list misses.
That is a GAP IN THE LIST, not a broken mechanism.

An earlier draft of this document claimed chain detection was systemically
broken. That was wrong and is corrected here.

**Residential: confirmed, and it is the real problem.** A repo-wide search for
residential / home-based / storefront returns only prose in `PATH_DESIGN.md`.
There is no implementation of any kind. This matches the customer's 70%.

## The frozen-verdict flaw, proven by those 18 rows

`is_chain` and `in_profile` are computed once per place at ingest
(`classifyProspect` in `supabase/functions/_shared/icpFilter.ts`) and written
into the row. NOTHING ever recomputes them: no backfill migration, no cron, no
admin RPC, no UI. The read path (`prospects_nearby`) reads the stored booleans
and never re-consults the brand list.

The True Value rows make this concrete rather than theoretical: adding
`true value` to `exclusion_seed` today would NOT hide those 18 stores. They were
stamped `is_chain = false` when first discovered and nothing will ever restamp
them. The same applies to the ~130 consumer-only types added on 2026-07-29,
which shipped with no backfill.

This is the flaw the architecture below removes, and it is why the fix is
worth doing even though the chain complaint turned out to be small.

## Decisions taken

1. A home-based business is a bad LEAD, not merely a bad door-knock. Filter them
   out rather than routing them to a separate call surface.
2. Filter aggressively, but always with an escape hatch. Reps can reveal what was
   hidden and use it anyway.
3. A trade business operating from a house is unwanted even if it is large.
4. The escape hatch appears on BOTH the nearby list and Plan a new area.
5. Classify at READ time, not ingest time.

## Architecture

Store facts, decide at search time.

Today: `Google -> classifyProspect -> frozen columns -> read filters on booleans`

New: `Google -> store raw facts -> prospects_nearby evaluates live rules`

`prospects.google_types` already carries the comment "raw Places types, for
re-classification". The original design anticipated this; only the
re-classification half was built.

Why read-time wins here:
- A brand added to `exclusion_seed` takes effect for every rep on their next
  search. No backfill, no re-pull, no Google spend. This alone fixes the
  reported bug.
- The escape hatch is nearly free: it is the same query without the filter.
- Every future rule change applies retroactively to the whole table.

The ingest classifier keeps writing its columns (harmless, useful for
debugging), but the read path stops depending on them. Removing the write is a
later cleanup, deliberately out of scope so this change stays reversible.

## New data

Three Places fields, all free on the tier we already bill at, added to the
`X-Goog-FieldMask` in `searchNearbyOneRequest`:

| Places field | Column | Why |
|---|---|---|
| `pureServiceAreaBusiness` | `pure_service_area boolean` | Google's own "serves customers at their location, not mine". The strongest home-based signal. |
| `containingPlaces` | `containing_places_count integer` | Non-empty means the business sits inside a mall, plaza or office building. Used to PROTECT, never to hide. |
| `accessibilityOptions` | `has_accessibility boolean` | A documented customer entrance. Houses do not have these. Used to PROTECT. |

All three are nullable and only populate for newly discovered businesses.
Therefore: **NULL never causes a hide.** Missing data means "we do not know",
and we do not hide on ignorance.

## The rules

Evaluated at read time inside `prospects_nearby`.

HIDE when ANY of:
- **Chain**: `name` matches an active `exclusion_seed.name_pattern`
  (case-insensitive substring, matching today's `matchesSeed` semantics), or
  matches a hardcoded enterprise brand.
- **Institutional**: `primary_type` is one of the institutional types
  (government office, city hall, courthouse, embassy, fire station, police,
  post office, hospital, military base, library).
- **Out of profile**: any entry of `google_types` is in the consumer-only list.
- **Home-based, Google-stated**: `pure_service_area = true`. Authoritative; not
  overridable by the protections below, because it is Google asserting the
  business has no customer-facing address.
- **Home-based, inferred**: `primary_type` is a trade type AND the business is
  not commercially protected. The trade list is a single named constant seeded
  with Google's trade taxonomy (plumber, electrician, roofing_contractor,
  general_contractor, painter, locksmith and siblings) and tuned from escape
  hatch feedback.

COMMERCIALLY PROTECTED when ANY of:
- `containing_places_count > 0` (it is inside a larger place).
- Three or more prospects share the same normalized address (a strip mall or
  office park). The threshold is deliberately low because protecting is the safe
  direction: it can only prevent an incorrect hide.
- `has_accessibility = true`.

## The escape hatch

On BOTH the nearby list and the Plan a new area results:

- A line under the results: "Show N filtered out".
- One tap reveals the hidden businesses, each tagged with its reason
  ("national chain", "home-based").
- A revealed business can be added to the day exactly like any other.

The taps are also the feedback signal. If reps repeatedly reveal and use the
same class of business, the rule is wrong and the usage tells us so.

## Performance

Checking ~300 brand patterns per query is more work than reading a boolean. The
candidate set is bounded first by `ST_DWithin`, category and limit, so the brand
check runs against a small survivor set, and the existing spatial and category
indexes still do the heavy narrowing.

Budget: `prospects_nearby` stays under roughly 300ms for a 15 mile radius over a
few hundred candidates. MEASURE rather than assume. If it exceeds the budget,
the fallback is a cached verdict column with a short lifetime (hours), refreshed
on read when stale, which keeps the "edit the list, see it immediately" property
while paying the match cost once instead of per query.

## Testing

A fixture set of real cases the rules must get right:

| Business | Expected | Why it is in the set |
|---|---|---|
| Home Depot | hidden | The reported bug. |
| Ace Hardware | hidden | Co-op naming; also the row most likely missing from prod's seed list. |
| A fast food chain | hidden | Named in the report. |
| Plumber at a residential address | hidden | The 70% case. |
| HVAC company at a house, high revenue | hidden | Decision 3 above, explicitly. |
| Barber in a converted house with a storefront | shown | The hard case: must NOT be hidden. |
| Shop inside a strip mall | shown | Protection via containing place. |
| One of five businesses at one address | shown | Protection via co-tenancy. |
| A business with no new fields populated (NULL) | shown | Proves NULL never hides. |

Plus: unit tests on the pure rule function, a SQL-level test of
`prospects_nearby`, and a test asserting that adding a pattern to
`exclusion_seed` changes the next query result with no backfill, which is the
property that fixes the reported bug.

## Out of scope

Deliberately not in this change:
- **Per-org or per-rep block lists** (`user_chain_override` in the backlog). The
  customer asked us to block centrally. Adding a tenancy layer here would be
  building for a request nobody made.
- **Franchisee targeting mode.** Needs firmographic enrichment.
- **Website-domain chain clustering.** A stronger chain detector, but a separate
  background job.
- **Backfilling the three new Places fields for existing rows.** They populate
  naturally as cells go cold. Noted as a possible follow-up once we can measure
  how much of the residual noise is old rows missing `pure_service_area`.
