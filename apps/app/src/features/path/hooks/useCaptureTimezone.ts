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
  const { data: stored, isSuccess } = usePathTimezone();
  const update = useUpdateTimezone();
  const done = useRef(false);

  useEffect(() => {
    // Gate on isSuccess, not !isLoading. A FAILED read also leaves `stored`
    // undefined, which the old check could not tell apart from "nothing stored
    // yet", so a rep whose session had dropped fired a doomed write on every
    // Path load. Worse than the wasted request: if the read failed but a later
    // write succeeded, a rep who had deliberately set their timezone had it
    // silently replaced by whatever device they happened to be holding, which
    // moves their whole day boundary. Only a read we know returned nothing may
    // trigger the capture.
    if (done.current || !isSuccess) return;
    if (stored) return; // already captured or rep-set; never overwrite
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!device || !isKnownTimezone(device)) return;
    done.current = true; // guard against a double-write before the query invalidates
    update.mutate(device);
  }, [stored, isSuccess, update]);
}
