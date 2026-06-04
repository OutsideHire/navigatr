-- Add the business phone to the path_stops snapshot so running mode's Call action
-- works without joining the volatile prospects cache (snapshot-renders philosophy,
-- same as name/address/lat/lng/category/primary_type). Nullable; legacy rows null.
alter table path_stops add column phone text;
