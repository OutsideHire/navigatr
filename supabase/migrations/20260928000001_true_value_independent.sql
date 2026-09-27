-- Stop treating True Value as a chain. Partner call, 2026-09-28.
--
-- Three days ago 20260925000002 added 'true value' to the chain block list
-- because a production sweep found 18 stores the list had missed. That read the
-- brand as a national chain. It is not one: True Value is a wholesale co-op
-- whose members are independently owned and operated, trading under their own
-- local names ("Adam True Value Hardware & Ag Sply"). An independent hardware
-- store is exactly the merchant a rep should be walking into, so hiding it is
-- the expensive direction of wrong.
--
-- Deactivating rather than deleting keeps the record of the decision, and the
-- read path already filters on `active`, so this takes effect on the next
-- search with no backfill.
update exclusion_seed
   set active = false
 where name_pattern = 'true value';

-- Deactivating the pattern is not enough on its own. Ingest stamps is_chain
-- onto the row permanently when a name matches an active seed pattern, and
-- nothing ever recomputes it, so every True Value discovered in the last three
-- days would stay hidden forever even with the pattern switched off.
--
-- Scoped to rows this seed row is responsible for (chain_reason = 'seed_list'
-- AND the True Value brand id), so a store flagged as a chain for some other
-- reason keeps that verdict. This can only make businesses visible again.
update prospects
   set is_chain         = false,
       chain_reason     = null,
       chain_confidence = null,
       chain_brand_id   = null,
       chain_brand_name = null
 where chain_brand_id = 'true_value'
   and chain_reason = 'seed_list';
