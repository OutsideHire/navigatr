-- Premises signals: the facts we need to tell a storefront from a house.
--
-- Beta customer reports ~70% of discovered businesses in their territory are
-- residential. We had NO residential concept at all; the only thing resembling
-- one was a handful of Google type strings in the consumer-only list.
--
-- Google has no "this is a home business" flag, so we collect the three nearest
-- proxies and let the read path weigh them. All three come from Places API
-- (New) fields we are ALREADY billed for: the field mask already requests
-- websiteUri / rating / userRatingCount, which are Enterprise-tier, and these
-- three are Pro-tier, which Enterprise includes. No SKU change.
--
-- Additive and nullable on purpose. They populate only for newly discovered
-- places, so every rule that reads them MUST treat NULL as "unknown" and never
-- hide on absence alone. Hiding a real merchant because Google was quiet about
-- it is the failure mode we care most about avoiding.
alter table prospects
  -- Google's own "serves customers at their location, not at mine". The single
  -- strongest home-based signal: high precision, low recall.
  add column if not exists pure_service_area boolean,
  -- How many places Google says this one sits INSIDE (a mall, plaza, office
  -- building). Used only to PROTECT a business from being hidden, never to hide.
  add column if not exists containing_places_count integer,
  -- A documented customer-facing entrance (wheelchair entrance/parking/restroom).
  -- Houses do not get these documented. Also protective only.
  add column if not exists has_accessibility boolean;

comment on column prospects.pure_service_area is
  'Places pureServiceAreaBusiness: business visits customers, no customer-facing address. NULL = unknown, never treat as false.';
comment on column prospects.containing_places_count is
  'Count of Places containingPlaces. >0 means inside a mall/plaza/office building: a commercial signal that PROTECTS from hiding.';
comment on column prospects.has_accessibility is
  'Any Places accessibilityOptions present: implies a documented customer entrance. Protective only.';
