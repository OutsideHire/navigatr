-- Per-partner required follow-up cadence, in days. null = no cadence (no
-- enforcement). The "due" date is derived client-side from
-- (last_touch_at ?? created_at) + followup_cadence_days; we store only the
-- interval here. No trigger. The existing partners UPDATE RLS policy (owner
-- or manager/admin) already governs this column — no new policy needed.
alter table partners
  add column followup_cadence_days int
  check (followup_cadence_days is null or (followup_cadence_days > 0 and followup_cadence_days <= 3650));
