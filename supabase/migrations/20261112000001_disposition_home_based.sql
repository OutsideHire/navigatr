-- Path Data Quality Fix v1.2, R5: a "Home-based" stop outcome.
--
-- On its own file because a new enum value cannot be used in the same
-- transaction that adds it, and the next migration's backfill and trigger
-- compare against it.
alter type disposition add value if not exists 'home_based';
