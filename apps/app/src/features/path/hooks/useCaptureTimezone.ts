/**
 * useCaptureTimezone - write the device's IANA zone to path_preferences once,
 * only when none is stored yet. This is both the first-run capture and the
 * backfill for existing reps (they get it on their next authed Path visit).
 *
 * It is a clock SETTING read (Intl.DateTimeFormat), not geolocation: no
 * permission prompt, and it works in an installed home-screen PWA. It never
 * overwrites a stored zone, so a rep who has set their zone in settings (or who
 * travels) is not clobbered by whatever the current device reports.
 */
import { useEffect, useRef } from "react";
import { usePathTimezone, useUpdateTimezone } from "./usePathPreferences";
import { isKnownTimezone } from "../lib/timezones";

export function useCaptureTimezone(): void {
  const { data: stored, isLoading } = usePathTimezone();
  const update = useUpdateTimezone();
  const done = useRef(false);

  useEffect(() => {
    if (done.current || isLoading) return;
    if (stored) return; // already captured or rep-set; never overwrite
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!device || !isKnownTimezone(device)) return;
    done.current = true; // guard against a double-write before the query invalidates
    update.mutate(device);
  }, [stored, isLoading, update]);
}
