/**
 * usePathPreferences — the rep's saved default industry selection (server-backed,
 * owner-scoped via RLS). Falls back to RECOMMENDED_SELECTION when there's no row
 * or an empty set. useUpdateDefaultIndustries upserts the one-row-per-rep preference.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { RECOMMENDED_SELECTION, selectedCategories, pruneToKnownCategories, type IndustrySelection } from "../lib/industrySelection";

export const PATH_PREFS_QUERY_KEY = ["path", "preferences"] as const;

/**
 * The persisted per-rep Path preferences row. `end_of_day_minutes` is the
 * per-rep end-of-day override (minutes from local midnight; null = use
 * DEFAULT_END_OF_DAY_MINUTES). Defined here so the field is available to the
 * types; B-T2 will actually read it. This task does not query the column, so the
 * hook's runtime behavior is unchanged.
 */
export interface PathPreferencesRow {
  user_id: string;
  default_industries: IndustrySelection;
  /** Per-rep start-of-day override (minutes from local midnight; null = use
   *  DEFAULT_START_OF_DAY_MINUTES). Sibling of end_of_day_minutes. */
  start_of_day_minutes: number | null;
  end_of_day_minutes: number | null;
  /** The rep's IANA timezone (e.g. "America/Chicago"), or null until captured
   *  from the device at sign-in. Day boundaries resolve in this zone. */
  timezone: string | null;
  updated_at: string;
}

export function usePathPreferences() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: [...PATH_PREFS_QUERY_KEY, userId],
    enabled: !!userId,
    queryFn: async (): Promise<IndustrySelection> => {
      const { data, error } = await (supabase
        .from("path_preferences")
        .select("default_industries")
        .maybeSingle() as unknown as Promise<{ data: { default_industries: IndustrySelection } | null; error: { message: string } | null }>);
      if (error) throw error;
      const saved = pruneToKnownCategories((data?.default_industries ?? {}) as IndustrySelection);
      return selectedCategories(saved).length > 0 ? saved : RECOMMENDED_SELECTION;
    },
  });
}

/**
 * usePathEndOfDayMinutes - the rep's per-rep end-of-day override (v2.2 B 4.3),
 * as minutes from local midnight, or null when unset (the caller then uses
 * DEFAULT_END_OF_DAY_MINUTES). Read as its own thin query so it can be consumed
 * (by useTodaysPath's capacity window) without disturbing the industry-selection
 * hook's IndustrySelection return contract. Owner-scoped via RLS.
 */
export function usePathEndOfDayMinutes() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: [...PATH_PREFS_QUERY_KEY, "end_of_day_minutes", userId],
    enabled: !!userId,
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await (supabase
        .from("path_preferences")
        .select("end_of_day_minutes")
        .maybeSingle() as unknown as Promise<{ data: { end_of_day_minutes: number | null } | null; error: { message: string } | null }>);
      if (error) throw error;
      return data?.end_of_day_minutes ?? null;
    },
  });
}

/** usePathStartOfDayMinutes - the rep's per-rep start-of-day override (v1.4
 *  Ticket 3a), minutes from local midnight, or null when unset (the caller then
 *  uses DEFAULT_START_OF_DAY_MINUTES). Own thin query, sibling of
 *  usePathEndOfDayMinutes. Owner-scoped via RLS. */
export function usePathStartOfDayMinutes() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: [...PATH_PREFS_QUERY_KEY, "start_of_day_minutes", userId],
    enabled: !!userId,
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await (supabase
        .from("path_preferences")
        .select("start_of_day_minutes")
        .maybeSingle() as unknown as Promise<{ data: { start_of_day_minutes: number | null } | null; error: { message: string } | null }>);
      if (error) throw error;
      return data?.start_of_day_minutes ?? null;
    },
  });
}

/** useUpdateStartOfDayMinutes - persist the rep's start-of-day override. Upserts
 *  ONLY the start_of_day_minutes column so it never disturbs the other prefs on
 *  the one-row-per-rep record. Owner-scoped via RLS. */
export function useUpdateStartOfDayMinutes() {
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async (startOfDayMinutes: number | null): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await (supabase
        .from("path_preferences")
        .upsert(
          { user_id: userId, start_of_day_minutes: startOfDayMinutes, updated_at: new Date().toISOString() },
          { onConflict: "user_id" },
        )
        .select()
        .single() as unknown as Promise<{ data: unknown; error: { message: string } | null }>);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: PATH_PREFS_QUERY_KEY }),
  });
}

/** usePathTimezone - the rep's stored IANA zone, or null when not yet captured.
 *  Its own thin query so consumers read it without the industry-selection hook's
 *  IndustrySelection return contract. Owner-scoped via RLS. */
export function usePathTimezone() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: [...PATH_PREFS_QUERY_KEY, "timezone", userId],
    enabled: !!userId,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await (supabase
        .from("path_preferences")
        .select("timezone")
        .maybeSingle() as unknown as Promise<{ data: { timezone: string | null } | null; error: { message: string } | null }>);
      if (error) throw error;
      return data?.timezone ?? null;
    },
  });
}

/** useUpdateTimezone - persist the rep's IANA zone. Upserts ONLY the timezone
 *  column so it never disturbs default_industries / end_of_day_minutes on the
 *  one-row-per-rep record. Owner-scoped via RLS. */
export function useUpdateTimezone() {
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async (timezone: string): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await (supabase
        .from("path_preferences")
        .upsert(
          { user_id: userId, timezone, updated_at: new Date().toISOString() },
          { onConflict: "user_id" },
        )
        .select()
        .single() as unknown as Promise<{ data: unknown; error: { message: string } | null }>);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: PATH_PREFS_QUERY_KEY }),
  });
}

export function useUpdateDefaultIndustries() {
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async (selection: IndustrySelection): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await (supabase
        .from("path_preferences")
        .upsert(
          { user_id: userId, default_industries: selection, updated_at: new Date().toISOString() },
          { onConflict: "user_id" },
        )
        .select()
        .single() as unknown as Promise<{ data: unknown; error: { message: string } | null }>);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: PATH_PREFS_QUERY_KEY }),
  });
}

/**
 * useUpdateEndOfDayMinutes - persist the rep's per-rep end-of-day override (v2.2
 * B 4.3), as minutes from local midnight, or null to clear it (fall back to
 * DEFAULT_END_OF_DAY_MINUTES). Upserts ONLY the end_of_day_minutes column so it
 * never disturbs the saved default_industries on the same one-row-per-rep record;
 * onConflict user_id updates just this column. Owner-scoped via RLS.
 */
export function useUpdateEndOfDayMinutes() {
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return useMutation({
    mutationFn: async (endOfDayMinutes: number | null): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await (supabase
        .from("path_preferences")
        .upsert(
          { user_id: userId, end_of_day_minutes: endOfDayMinutes, updated_at: new Date().toISOString() },
          { onConflict: "user_id" },
        )
        .select()
        .single() as unknown as Promise<{ data: unknown; error: { message: string } | null }>);
      if (error) throw error;
    },
    // Invalidate the 2-element prefix so BOTH the industries read
    // (["path","preferences",userId]) AND the separately-keyed end-of-day read
    // (["path","preferences","end_of_day_minutes",userId]) refetch. Keying on
    // [...KEY, userId] would prefix-miss the end-of-day query and leave the
    // control + capacity window stale until a refocus.
    onSuccess: () => qc.invalidateQueries({ queryKey: PATH_PREFS_QUERY_KEY }),
  });
}
