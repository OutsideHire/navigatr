-- Local development seed. Runs after migrations during `supabase db reset`.
--
-- Gives you an org you can actually LOG IN to, so a reset leaves you one
-- `pnpm dev:app` away from a working app rather than an empty shell.
--
--   URL:      http://localhost:5173
--   Email:    manager@navigatr.test   (org administrator)
--             rep1@navigatr.test / rep2@navigatr.test / rep3@navigatr.test
--   Password: navigatr123             (all four)
--
-- LOCAL ONLY. These are throwaway credentials for a database that lives in
-- Docker on your machine. `config.toml` points db.seed at this file, and
-- db.seed runs on `db reset`, never against a remote project.
--
-- HOW THE USERS GET THEIR PROFILES: we do NOT insert into `profiles` directly.
-- We insert into `auth.users` with an `invite_code` in raw_user_meta_data, which
-- fires the real `handle_new_user_signup` trigger (20260517000002). That trigger
-- resolves the org, makes the FIRST user in it an administrator and everyone
-- after a rep, and creates the profile row. Seeding this way means the seed
-- exercises the same path a real signup takes, so if that trigger ever breaks,
-- `supabase db reset` breaks too, loudly and immediately.
--
-- `auth.identities` is what makes the account usable by the email/password
-- provider. Without it, GoTrue authenticates nobody, which is the trap that
-- makes hand-written auth seeds look correct and fail at the login screen.

-- ---------------------------------------------------------------------------
-- Organization
-- ---------------------------------------------------------------------------
insert into organizations (id, name, slug, invite_code, is_disabled) values
  ('5eed0000-0000-4000-8000-000000000001', 'Northstar Payments', 'northstar-payments', 'northstar-local', false);

-- ---------------------------------------------------------------------------
-- Users. Order matters: the first row becomes the administrator.
-- ---------------------------------------------------------------------------
-- The empty strings are not decoration. GoTrue scans confirmation_token and its
-- siblings into Go strings, and a NULL fails the whole login with
-- "Database error querying schema" / "converting NULL to string is
-- unsupported". The row looks perfectly fine in psql; it only breaks at the
-- login screen. This is the single most common way a hand-written auth seed
-- fails.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_user_meta_data, raw_app_meta_data,
  created_at, updated_at, email_confirmed_at, last_sign_in_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  u.id,
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  u.email,
  extensions.crypt('navigatr123', extensions.gen_salt('bf')),
  jsonb_build_object('invite_code', 'northstar-local', 'full_name', u.full_name),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  now(), now(), now(), now(),
  '', '', '', '', '', '', '', ''
from (values
  ('5eed0000-0000-4000-8000-00000000000a'::uuid, 'manager@navigatr.test', 'Dana Reyes'),
  ('5eed0000-0000-4000-8000-00000000000b'::uuid, 'rep1@navigatr.test',    'Marcus Hale'),
  ('5eed0000-0000-4000-8000-00000000000c'::uuid, 'rep2@navigatr.test',    'Priya Nandi'),
  ('5eed0000-0000-4000-8000-00000000000d'::uuid, 'rep3@navigatr.test',    'Theo Brandt'),
  -- Dedicated rep for the Playwright rep golden-path specs (apps/app/e2e/rep).
  -- Owns NO deals on purpose, so their running Path has no owed / appointment
  -- cards competing with the seeded nearby stops, the drop-in spec lands
  -- deterministically on a nearby stop whose "I'm here" opens the DropInSheet.
  ('5eed0000-0000-4000-8000-00000000000e'::uuid, 'repe2e@navigatr.test',  'Evan Tester'),
  -- Second dedicated dealless rep, for the running-carousel + carry-to-tomorrow
  -- E2E. It MUTATES its path (carry completes today + reparents stops to
  -- tomorrow), so it must not share repe2e's path with the other rep specs.
  ('5eed0000-0000-4000-8000-00000000000f'::uuid, 'repcarousel@navigatr.test', 'Cara Ruiz')
) as u(id, email, full_name)
order by u.email = 'manager@navigatr.test' desc, u.email;

-- The email/password provider needs a matching identity row per user.
-- `auth.identities.email` is a GENERATED column (derived from
-- identity_data->>'email'), so it must not be supplied.
insert into auth.identities (user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
select
  u.id,
  u.id::text,
  'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  now(), now(), now()
from auth.users u;

-- ---------------------------------------------------------------------------
-- Prospects. `location` and `last_refreshed_at` are set by the
-- prospects_set_location BEFORE trigger from lat/lng, so they are not supplied.
-- `geo_cell` is NOT trigger-set: discover_prospects computes it in TypeScript
-- (geohash precision 5, ~4.9km) and supplies it on insert, so the seed must too.
-- These values were produced by the repo's own encodeGeohash from
-- _shared/geohash.ts rather than computed by hand.
-- Coordinates are around downtown Sacramento.
-- ---------------------------------------------------------------------------
insert into prospects (place_id, name, category, lat, lng, geo_cell, address, phone, rating, rating_count) values
  ('seed_place_001', 'Rivera Auto Body',        'car_repair',   38.5816, -121.4944, '9qce7', '1420 J St, Sacramento, CA',    '(916) 555-0142', 4.4,  86),
  ('seed_place_002', 'Golden Bear Dry Cleaners','laundry',      38.5790, -121.4910, '9qce7', '905 15th St, Sacramento, CA',  '(916) 555-0177', 4.1,  32),
  ('seed_place_003', 'Delta Print & Sign',      'store',        38.5842, -121.4885, '9qcee', '2100 Q St, Sacramento, CA',    '(916) 555-0198', 4.6,  54),
  ('seed_place_004', 'Sierra Family Dental',    'dentist',      38.5771, -121.4967, '9qce7', '730 K St, Sacramento, CA',     '(916) 555-0119', 4.8, 211),
  ('seed_place_005', 'Capitol Coffee Roasters', 'cafe',         38.5805, -121.4931, '9qce7', '1201 K St, Sacramento, CA',    '(916) 555-0163', 4.3, 402);

-- ---------------------------------------------------------------------------
-- Deals across different stages, owned by the reps.
-- ---------------------------------------------------------------------------
insert into deals (id, org_id, owner_id, company_name, contact_name, contact_phone, contact_email, address, stage, value_cents, lead_source, source) values
  ('5eed0000-0000-4000-8000-0000000000d1', '5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-00000000000b',
   'Rivera Auto Body',         'Luis Rivera',  '(916) 555-0142', 'luis@riveraauto.test',   '1420 J St, Sacramento, CA',   'qualified', 480000,  'path',     'path'),
  ('5eed0000-0000-4000-8000-0000000000d2', '5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-00000000000c',
   'Golden Bear Dry Cleaners', 'Anna Cho',     '(916) 555-0177', 'anna@goldenbear.test',   '905 15th St, Sacramento, CA', 'contacted', 216000,  'path',     'path'),
  ('5eed0000-0000-4000-8000-0000000000d3', '5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-00000000000d',
   'Sierra Family Dental',     'Dr. Ken Sato', '(916) 555-0119', 'ken@sierradental.test',  '730 K St, Sacramento, CA',    'won',      1140000, 'customer_referral', 'manual');

-- ---------------------------------------------------------------------------
-- Activities spread over the last two weeks, so the dashboards and the
-- Activity-to-Win report have something to chart rather than an empty state.
-- ---------------------------------------------------------------------------
insert into activities (org_id, deal_id, logged_by, type, disposition, occurred_at, outcome_notes)
select
  '5eed0000-0000-4000-8000-000000000001',
  a.deal_id,
  a.logged_by,
  a.type::activity_type,
  a.disposition::disposition,
  now() - (a.days_ago || ' days')::interval,
  a.outcome_notes
from (values
  ('5eed0000-0000-4000-8000-0000000000d1'::uuid, '5eed0000-0000-4000-8000-00000000000b'::uuid, 'drop_in',     'met_dm',              13, 'Walked in, owner on site. Uses a terminal from 2019.'),
  ('5eed0000-0000-4000-8000-0000000000d1'::uuid, '5eed0000-0000-4000-8000-00000000000b'::uuid, 'call',        'connected_with_dm',   11, 'Talked rates. Wants a statement review.'),
  ('5eed0000-0000-4000-8000-0000000000d1'::uuid, '5eed0000-0000-4000-8000-00000000000b'::uuid, 'email',       'sent_pricing',         9, 'Sent side-by-side pricing.'),
  ('5eed0000-0000-4000-8000-0000000000d1'::uuid, '5eed0000-0000-4000-8000-00000000000b'::uuid, 'appointment', 'appt_statements_collected', 4, 'Collected three months of statements.'),
  ('5eed0000-0000-4000-8000-0000000000d2'::uuid, '5eed0000-0000-4000-8000-00000000000c'::uuid, 'drop_in',     'gatekeeper',          12, 'Owner out. Front counter took a card.'),
  ('5eed0000-0000-4000-8000-0000000000d2'::uuid, '5eed0000-0000-4000-8000-00000000000c'::uuid, 'call',        'no_answer',            8, 'No answer, no voicemail set up.'),
  ('5eed0000-0000-4000-8000-0000000000d2'::uuid, '5eed0000-0000-4000-8000-00000000000c'::uuid, 'call',        'scheduled_callback',   3, 'Owner asked for Tuesday morning.'),
  ('5eed0000-0000-4000-8000-0000000000d3'::uuid, '5eed0000-0000-4000-8000-00000000000d'::uuid, 'drop_in',     'met_dm',              14, 'Intro with the practice manager.'),
  ('5eed0000-0000-4000-8000-0000000000d3'::uuid, '5eed0000-0000-4000-8000-00000000000d'::uuid, 'appointment', 'appt_verbal_commitment', 7, 'Verbal yes pending partner sign-off.'),
  ('5eed0000-0000-4000-8000-0000000000d3'::uuid, '5eed0000-0000-4000-8000-00000000000d'::uuid, 'appointment', 'appt_application_signed', 2, 'Signed. Submitted for boarding.')
) as a(deal_id, logged_by, type, disposition, days_ago, outcome_notes);

-- ---------------------------------------------------------------------------
-- E2E rep golden-path fixture (apps/app/e2e/rep). A saved TODAY path for the
-- dedicated dealless rep (repe2e, …000e), with two nearby stops pointing at
-- prospects that have NO active deal (Delta Print & Sign, Capitol Coffee), so a
-- drop-in on them cleanly creates a new deal. `path_date = current_date` and
-- `started_at = now()` land the rep straight in the running view (RunningPath);
-- the stops are the only cards (no deals -> no owed/appointment cards), so the
-- first "I'm here" opens the create-deal DropInSheet. path_stops copies the
-- prospect's display snapshot; `prospect_id` is resolved by place_id.
-- ---------------------------------------------------------------------------
insert into paths (id, user_id, path_date, origin_label, origin_lat, origin_lng, status, started_at, name) values
  ('5eed0000-0000-4000-8000-0000000000f1', '5eed0000-0000-4000-8000-00000000000e', current_date,
   'Downtown Sacramento', 38.5816, -121.4944, 'planned', now(), 'E2E rep day');

insert into path_stops (path_id, prospect_id, name, address, lat, lng, category, primary_type, position, status)
select
  '5eed0000-0000-4000-8000-0000000000f1',
  p.id, p.name, p.address, p.lat, p.lng, p.category, null,
  case p.place_id when 'seed_place_003' then 1 else 2 end,
  'pending'
from prospects p
where p.place_id in ('seed_place_003', 'seed_place_005');

-- Running-carousel + carry-to-tomorrow fixture: a SECOND rep (repcarousel) with
-- its own today's path of two pending stops. Kept separate from repe2e's path
-- because the carousel spec skips a stop and carries the rest to tomorrow
-- (completing today's path), which would otherwise clobber the drop-in/path
-- specs that run against repe2e in the same CI job.
insert into paths (id, user_id, path_date, origin_label, origin_lat, origin_lng, status, started_at, name) values
  ('5eed0000-0000-4000-8000-0000000000f2', '5eed0000-0000-4000-8000-00000000000f', current_date,
   'Downtown Sacramento', 38.5816, -121.4944, 'planned', now(), 'E2E carousel day');

insert into path_stops (path_id, prospect_id, name, address, lat, lng, category, primary_type, position, status)
select
  '5eed0000-0000-4000-8000-0000000000f2',
  p.id, p.name, p.address, p.lat, p.lng, p.category, null,
  case p.place_id when 'seed_place_003' then 1 else 2 end,
  'pending'
from prospects p
where p.place_id in ('seed_place_003', 'seed_place_005');
