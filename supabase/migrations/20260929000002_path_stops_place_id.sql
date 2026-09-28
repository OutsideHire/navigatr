-- Keep the Google place id on a path stop, so a drop-in logged while DRIVING
-- creates a deal that can be de-duplicated and repaired like any other.
--
-- WHY. path_stops is a deliberate SNAPSHOT: it copies name/address/lat/lng off
-- the prospect at add time so the running view needs no join and survives later
-- prospect edits (see the prospect_id comment in 20260603000001). The snapshot
-- simply never included place_id. So merchantFromStop cannot set it, DropInSheet
-- passes undefined, and every deal created from the driving carousel lands with
-- place_id NULL.
--
-- That costs two things. It loses the org-wide de-dup anchor that the pipeline
-- de-duplication work is built on, so the same merchant can be added twice by
-- two reps. And it is the key a backfill would join on, so those deals cannot be
-- repaired from the prospects cache either. The driving carousel is the screen
-- reps actually use in the field, so this is the common case, not the edge.
alter table path_stops add column if not exists place_id text;

-- Backfill every existing stop. This is free and exact: prospect_id is NOT NULL
-- and prospects is upsert-only with nothing that hard-deletes rows (same comment
-- in 20260603000001), so the join always resolves.
update path_stops s
   set place_id = p.place_id
  from prospects p
 where p.id = s.prospect_id
   and s.place_id is null;

comment on column path_stops.place_id is
  'Google place id, snapshotted from the prospect at add time. Lets a drop-in logged from the running view create a deal with a de-dup anchor.';

-- Note for anyone repairing DEALS: this does not fix deals already created from
-- the driving view, which still carry place_id NULL. Those would have to be
-- matched back through deals.source_path_id plus the stop name, which is fuzzy
-- enough to want a human looking at it. Deliberately not attempted here.
