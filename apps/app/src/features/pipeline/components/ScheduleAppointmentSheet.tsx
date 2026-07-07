/**
 * ScheduleAppointmentSheet — "Two-way calendar sync, Milestone 1."
 *
 * Opens from the Deal Detail Quick actions card ("Schedule appointment").
 * A rep books a future appointment FROM a deal: title / date / start time /
 * duration / location / notes. On submit we compose start/end ISO timestamps,
 * geocode the location string (best-effort, same `geocode` Edge function Path
 * uses via usePathOrigin), gather attendee emails (the deal's primary email +
 * any deal-contact emails), and call useScheduleAppointment().mutate(...).
 *
 * Same Radix Dialog shell + navigatr primitives as SendReferralSheet.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  Button,
  FormField,
  Input,
  Select,
  NotesFieldWithMic,
  type SelectOption,
} from "@/components/navigatr";
import { useScheduleAppointment } from "@/features/appointments/useAppointments";
import { useDealContacts } from "../hooks/useDealContacts";

/** Minimal deal shape this sheet needs — a full Deal satisfies it. */
export interface ScheduleAppointmentDeal {
  id: string;
  companyName: string;
  address?: string | null;
  /** Primary contact email — always included as an attendee when present. */
  email?: string | null;
}

export interface ScheduleAppointmentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal: ScheduleAppointmentDeal;
}

const DURATION_OPTIONS: SelectOption[] = [
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1.5 hours" },
];

interface GeocodeResponse {
  result: { lat: number; lng: number; label: string } | null;
}

/**
 * Attendee emails for the appointment: the deal's primary contact email plus
 * any deal-contact emails. Deduplicated, trimmed, empties dropped. Milestone 1
 * collects these; the sync_appointment function attaches them to the event.
 */
export function collectAttendeeEmails(
  primaryEmail: string | null | undefined,
  contactEmails: Array<string | null | undefined>,
): string[] {
  return Array.from(
    new Set(
      [primaryEmail, ...contactEmails]
        .map((e) => (e ?? "").trim())
        .filter(Boolean),
    ),
  );
}

/**
 * Best-effort geocode of a free-text location via the `geocode` Edge function
 * (the same one usePathOrigin uses). Returns null coords on any miss/failure —
 * scheduling proceeds without lat/lng rather than blocking the rep.
 */
async function geocodeLocation(
  query: string,
): Promise<{ lat: number | null; lng: number | null }> {
  const q = query.trim();
  if (!q) return { lat: null, lng: null };
  try {
    const { data, error } = await supabase.functions.invoke<GeocodeResponse>(
      "geocode",
      { body: { query: q } },
    );
    if (error) throw error;
    const result = data?.result;
    if (!result) return { lat: null, lng: null };
    return { lat: result.lat, lng: result.lng };
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error("[ScheduleAppointmentSheet] geocode failed", err);
    }
    return { lat: null, lng: null };
  }
}

export function ScheduleAppointmentSheet({
  open,
  onOpenChange,
  deal,
}: ScheduleAppointmentSheetProps) {
  const schedule = useScheduleAppointment();
  const { data: contacts = [] } = useDealContacts(deal.id);

  const defaultTitle = `Appointment — ${deal.companyName}`;

  const [title, setTitle] = React.useState(defaultTitle);
  const [date, setDate] = React.useState("");
  const [startTime, setStartTime] = React.useState("");
  const [duration, setDuration] = React.useState("30");
  const [location, setLocation] = React.useState(deal.address ?? "");
  const [notes, setNotes] = React.useState("");

  // Reset the form whenever the sheet (re)opens for a deal.
  React.useEffect(() => {
    if (!open) return;
    setTitle(`Appointment — ${deal.companyName}`);
    setDate("");
    setStartTime("");
    setDuration("30");
    setLocation(deal.address ?? "");
    setNotes("");
  }, [open, deal.companyName, deal.address]);

  const canSubmit = Boolean(date && startTime) && !schedule.isPending;

  const onSubmit = async () => {
    if (!date || !startTime) return;

    // Compose local date+time → ISO. `new Date("YYYY-MM-DDTHH:mm")` parses in
    // local time; end = start + duration guarantees end > start.
    const start = new Date(`${date}T${startTime}`);
    if (Number.isNaN(start.getTime())) {
      toast.error("Enter a valid date and time");
      return;
    }
    const end = new Date(start.getTime() + Number(duration) * 60_000);
    const startAt = start.toISOString();
    const endAt = end.toISOString();

    const { lat, lng } = await geocodeLocation(location);

    // Attendee emails: the deal's primary contact + any deal-contact emails.
    // useScheduleAppointment doesn't carry attendees yet (Milestone 1 scope),
    // so we fold them into the notes so nothing is lost on the persisted row.
    const attendees = collectAttendeeEmails(
      deal.email,
      contacts.map((c) => c.email),
    );
    const baseNotes = notes.trim();
    const composedNotes =
      attendees.length > 0
        ? [baseNotes, `Attendees: ${attendees.join(", ")}`]
            .filter(Boolean)
            .join("\n\n")
        : baseNotes;

    try {
      await schedule.mutateAsync({
        dealId: deal.id,
        title: title.trim() || defaultTitle,
        startAt,
        endAt,
        locationAddress: location.trim() || null,
        locationLat: lat,
        locationLng: lng,
        notes: composedNotes || null,
      });
      toast.success("Appointment scheduled");
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't schedule appointment",
      );
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-md flex-col gap-4 rounded-t-radius-lg bg-surface-default p-5 shadow-card-hover sm:inset-0 sm:bottom-auto sm:top-1/2 sm:max-h-[85dvh] sm:-translate-y-1/2 sm:overflow-y-auto sm:rounded-radius-lg"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-heading-sm text-text-default">
              Schedule appointment
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="Close"
                className="rounded-radius-sm p-1 text-text-muted hover:text-text-default"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <FormField htmlFor="appt-title" label="Title">
            <Input
              id="appt-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Appointment title"
            />
          </FormField>

          <div className="flex gap-3">
            <FormField htmlFor="appt-date" label="Date" required>
              <Input
                id="appt-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </FormField>
            <FormField htmlFor="appt-start" label="Start time" required>
              <Input
                id="appt-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </FormField>
          </div>

          <FormField htmlFor="appt-duration" label="Duration">
            <Select
              id="appt-duration"
              value={duration}
              onValueChange={setDuration}
              options={DURATION_OPTIONS}
            />
          </FormField>

          <FormField htmlFor="appt-location" label="Location">
            <Input
              id="appt-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Address or meeting location"
            />
          </FormField>

          <NotesFieldWithMic
            value={notes}
            onChange={setNotes}
            placeholder="Add notes for this appointment (optional)"
          />

          <div className="flex gap-2 pt-1">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={!canSubmit}
              loading={schedule.isPending}
              onClick={onSubmit}
            >
              Schedule
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default ScheduleAppointmentSheet;
