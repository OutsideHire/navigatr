/**
 * EmailCaptureDisclosure — the "what we capture" notice shown on the Outlook
 * card when Automatic Email Activity Capture is enabled (PRD D-07, Slice 5c).
 *
 * Connecting Outlook with the feature on also grants read-only mail-metadata
 * access, so the rep must see, before connecting, exactly what is and isn't
 * captured. Presentational only; the caller decides when to show it (flag on +
 * Outlook), and passes `connected` to switch between the pre-connect consent
 * copy and the post-connect reminder.
 */
import { MailCheck } from "lucide-react";

export function EmailCaptureDisclosure({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-start gap-2 rounded-radius-sm bg-surface-sunken p-3">
      <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-teal" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="text-label text-text-default">
          {connected ? "Email logging is on" : "This also turns on email logging"}
        </p>
        {connected ? (
          <p className="text-body-sm text-text-muted">
            navigatr suggests logging the emails you send that match a deal.
            Confirm each one from Activities. We read only the details (recipients,
            subject, and time), never the message body or attachments.
          </p>
        ) : (
          <p className="text-body-sm text-text-muted">
            Connecting Outlook also lets navigatr read the details of emails you
            send (recipients, subject, and time) to suggest logging them against
            the matching deal. We never read the message body or attachments, and
            nothing is logged until you confirm it.
          </p>
        )}
      </div>
    </div>
  );
}
