/**
 * EmailSuggestionsSection — rep-facing "Suggested from email" nudge on the
 * Activities page (Email Capture Phase 1, Slice 5b, D-07). Lists the rep's own
 * auto-captured sent emails that matched a deal and are awaiting confirmation.
 * Confirm turns one into a logged email activity; Dismiss drops it. Nothing is
 * logged without the rep's tap.
 *
 * Dark by default: the whole feature ships behind VITE_EMAIL_CAPTURE, so the
 * section (and its query) do not run until the flag is set. The outer gate holds
 * no hooks so the flag check is a clean early return; the inner component owns
 * all the data hooks. Renders nothing when there are no suggestions.
 */

import { Mail } from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import { useEmailSuggestions } from "../hooks/useEmailSuggestions";
import {
  useConfirmEmailSuggestion,
  useDismissEmailSuggestion,
} from "../hooks/useEmailSuggestionActions";
import { relativeTime } from "./UnloggedCallsSection";
import { EMAIL_CAPTURE_UI_ENABLED } from "@/lib/emailCaptureFlag";

// Re-export so existing importers of this module keep resolving the flag.
export { EMAIL_CAPTURE_UI_ENABLED };

export function EmailSuggestionsSection({
  enabled = EMAIL_CAPTURE_UI_ENABLED,
}: { enabled?: boolean } = {}) {
  if (!enabled) return null;
  return <EmailSuggestions />;
}

function EmailSuggestions() {
  const { data: suggestions = [] } = useEmailSuggestions();
  const confirm = useConfirmEmailSuggestion();
  const dismiss = useDismissEmailSuggestion();

  if (suggestions.length === 0) return null;

  return (
    <Card className="mb-4 flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-accent-teal" aria-hidden />
        <h2 className="text-heading-sm text-text-default">
          Suggested from email ({suggestions.length})
        </h2>
      </div>
      <p className="text-body-sm text-text-muted">
        We matched these sent emails to a deal. Confirm to log them, or dismiss.
      </p>
      <ul className="flex flex-col gap-2">
        {suggestions.map((s) => {
          const busy =
            (confirm.isPending && confirm.variables === s.id) ||
            (dismiss.isPending && dismiss.variables === s.id);
          return (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-radius-sm bg-surface-sunken px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-label text-text-default">{s.companyName}</p>
                <p className="truncate text-body-sm text-text-muted">
                  {s.deepLinkUrl ? (
                    <a
                      href={s.deepLinkUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline hover:text-text-default"
                    >
                      {s.subject}
                    </a>
                  ) : (
                    s.subject
                  )}
                  {s.recipientSummary ? ` · to ${s.recipientSummary}` : ""}
                  {" · "}
                  {relativeTime(s.sentAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="tertiary"
                  size="sm"
                  disabled={busy}
                  onClick={() => dismiss.mutate(s.id)}
                >
                  Dismiss
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => confirm.mutate(s.id)}
                >
                  Confirm
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
