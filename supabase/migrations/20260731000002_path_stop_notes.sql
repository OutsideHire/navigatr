-- Path drop-in dictated notes: give a path stop a place to keep the rep's note.
--
-- The drop-in sheet gains a (voice-dictated) notes field that works on EVERY
-- outcome, including dead-ends that create no deal. Terminal outcomes only touch
-- path_stops (no activity/deal), so the note lives here. For follow-up outcomes
-- the same text also flows onto the deal's drop_in activity (outcome_notes), but
-- path_stops.notes is the always-present home so no note is ever lost.

alter table path_stops add column if not exists notes text;
