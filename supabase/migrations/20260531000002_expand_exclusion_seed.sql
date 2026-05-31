-- Expand the navigatr-curated chain seed list (FR-PATH-12/13).
--
-- Phase 1 shipped 30 of the biggest national brands. Live testing in Austin
-- surfaced the gap: the same-name-density backstop only counts duplicates
-- within ONE geohash cell against a threshold of 10, so a chain with 2-3
-- nearby locations (Whole Foods, Trader Joe's, H-E-B) slips through as a
-- "servable SMB." The durable fix is a bigger curated seed list — the density
-- heuristic is only meant to catch UNKNOWN chains the seed list misses.
--
-- This migration adds ~70 more national/regional brands across grocery,
-- warehouse/retail, QSR/fast-casual, casual dining, coffee, banks, fuel/
-- convenience, telecom, fitness, auto-service, and rental. Idempotent:
-- `on conflict (name_pattern) do nothing` so re-running (or overlap with the
-- original 30) is a no-op.
--
-- name_pattern is a lowercase, case-insensitive SUBSTRING matched against the
-- business name. Keep patterns short and distinctive enough to avoid false
-- positives on independents (e.g. 'culver' not 'culvers restaurant').

insert into exclusion_seed (name_pattern, brand, scope) values
  -- grocery
  ('whole foods',      'Whole Foods Market', 'national'),
  ('trader joe',       'Trader Joe''s',      'national'),
  ('kroger',           'Kroger',             'national'),
  ('h-e-b',            'H-E-B',              'regional'),
  ('safeway',          'Safeway',            'national'),
  ('albertsons',       'Albertsons',         'national'),
  ('publix',           'Publix',             'national'),
  ('aldi',             'ALDI',               'national'),
  ('sprouts',          'Sprouts Farmers Market', 'national'),
  ('food lion',        'Food Lion',          'national'),
  ('giant eagle',      'Giant Eagle',        'national'),
  -- warehouse / big-box retail
  ('costco',           'Costco',             'national'),
  ('sam''s club',      'Sam''s Club',        'national'),
  ('best buy',         'Best Buy',           'national'),
  ('petsmart',         'PetSmart',           'national'),
  ('petco',            'Petco',              'national'),
  ('dollar general',   'Dollar General',     'national'),
  ('dollar tree',      'Dollar Tree',        'national'),
  ('family dollar',    'Family Dollar',      'national'),
  ('o''reilly',        'O''Reilly Auto Parts', 'national'),
  ('advance auto',     'Advance Auto Parts', 'national'),
  -- QSR / fast-casual
  ('chick-fil-a',      'Chick-fil-A',        'national'),
  ('panera',           'Panera Bread',       'national'),
  ('five guys',        'Five Guys',          'national'),
  ('whataburger',      'Whataburger',        'regional'),
  ('popeyes',          'Popeyes',            'national'),
  ('kfc',              'KFC',                'national'),
  ('panda express',    'Panda Express',      'national'),
  ('raising cane',     'Raising Cane''s',    'national'),
  ('culver',           'Culver''s',          'national'),
  ('papa john',        'Papa John''s',       'national'),
  ('little caesar',    'Little Caesars',     'national'),
  ('wingstop',         'Wingstop',           'national'),
  ('arby',             'Arby''s',            'national'),
  ('sonic drive',      'Sonic Drive-In',     'national'),
  ('jack in the box',  'Jack in the Box',    'national'),
  ('del taco',         'Del Taco',           'national'),
  ('in-n-out',         'In-N-Out Burger',    'regional'),
  ('qdoba',            'Qdoba',              'national'),
  ('moe''s southwest', 'Moe''s Southwest Grill', 'national'),
  ('firehouse subs',   'Firehouse Subs',     'national'),
  ('jersey mike',      'Jersey Mike''s',     'national'),
  ('zaxby',            'Zaxby''s',           'national'),
  ('bojangles',        'Bojangles',          'regional'),
  -- casual dining
  ('applebee',         'Applebee''s',        'national'),
  ('chili''s',         'Chili''s',           'national'),
  ('olive garden',     'Olive Garden',       'national'),
  ('ihop',             'IHOP',               'national'),
  ('denny',            'Denny''s',           'national'),
  ('waffle house',     'Waffle House',       'national'),
  ('texas roadhouse',  'Texas Roadhouse',    'national'),
  ('outback',          'Outback Steakhouse', 'national'),
  ('red lobster',      'Red Lobster',        'national'),
  ('buffalo wild wings','Buffalo Wild Wings','national'),
  ('cheesecake factory','The Cheesecake Factory','national'),
  ('cracker barrel',   'Cracker Barrel',     'national'),
  -- coffee / dessert
  ('dutch bros',       'Dutch Bros',         'national'),
  ('krispy kreme',     'Krispy Kreme',       'national'),
  ('baskin-robbins',   'Baskin-Robbins',     'national'),
  ('dairy queen',      'Dairy Queen',        'national'),
  ('cold stone',       'Cold Stone Creamery','national'),
  ('tim hortons',      'Tim Hortons',        'national'),
  -- pharmacy / banks / financial
  ('rite aid',         'Rite Aid',           'national'),
  ('us bank',          'U.S. Bank',          'national'),
  ('pnc',              'PNC Bank',           'national'),
  ('truist',           'Truist',             'national'),
  ('capital one',      'Capital One',        'national'),
  ('citibank',         'Citibank',           'national'),
  ('td bank',          'TD Bank',            'national'),
  ('regions bank',     'Regions Bank',       'national'),
  ('fifth third',      'Fifth Third Bank',   'national'),
  -- fuel / convenience
  ('valero',           'Valero',             'national'),
  ('circle k',         'Circle K',           'national'),
  ('quiktrip',         'QuikTrip',           'regional'),
  ('wawa',             'Wawa',               'regional'),
  ('buc-ee',           'Buc-ee''s',          'regional'),
  ('racetrac',         'RaceTrac',           'regional'),
  ('speedway',         'Speedway',           'national'),
  ('casey',            'Casey''s',           'regional'),
  -- telecom
  ('verizon',          'Verizon',            'national'),
  ('at&t',             'AT&T',               'national'),
  ('t-mobile',         'T-Mobile',           'national'),
  ('xfinity',          'Xfinity',            'national'),
  -- fitness
  ('la fitness',       'LA Fitness',         'national'),
  ('anytime fitness',  'Anytime Fitness',    'national'),
  ('orangetheory',     'Orangetheory Fitness','national'),
  ('crunch fitness',   'Crunch Fitness',     'national'),
  ('lifetime fitness', 'Life Time',          'national'),
  ('24 hour fitness',  '24 Hour Fitness',    'national'),
  -- hair / personal care
  ('supercuts',        'Supercuts',          'national'),
  ('sport clips',      'Sport Clips',        'national'),
  ('great clips',      'Great Clips',        'national'),
  -- auto service
  ('midas',            'Midas',              'national'),
  ('jiffy lube',       'Jiffy Lube',         'national'),
  ('valvoline',        'Valvoline',          'national'),
  ('take 5 oil',       'Take 5 Oil Change',  'national'),
  ('discount tire',    'Discount Tire',      'national'),
  ('firestone',        'Firestone',          'national'),
  ('pep boys',         'Pep Boys',           'national'),
  -- rental / shipping / misc retail
  ('enterprise rent',  'Enterprise Rent-A-Car', 'national'),
  ('u-haul',           'U-Haul',             'national'),
  ('hertz',            'Hertz',              'national'),
  ('avis',             'Avis',               'national'),
  ('gamestop',         'GameStop',           'national'),
  ('ace hardware',     'Ace Hardware',       'national'),
  ('tractor supply',   'Tractor Supply',     'national'),
  ('ross dress',       'Ross Dress for Less','national'),
  ('marshalls',        'Marshalls',          'national'),
  ('t.j. maxx',        'T.J. Maxx',          'national'),
  ('tj maxx',          'T.J. Maxx',          'national'),
  ('kohl',             'Kohl''s',            'national'),
  ('michaels',         'Michaels',           'national'),
  ('hobby lobby',      'Hobby Lobby',        'national')
on conflict (name_pattern) do nothing;
