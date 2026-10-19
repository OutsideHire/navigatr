/**
 * One referral the ISO sent to the partner (FR-PORT-76, 77, 78): the business,
 * its partner label, who sent it and the note they wrote for the partner (only
 * when they wrote one for the partner), the contact details, and the partner's
 * own notes back with a composer. The sender is emailed for each note.
 * Refreshes every 30 seconds.
 */
import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Loader2, Mail, Phone } from "lucide-react";
import { Button, Card, FormField, Textarea } from "@/components/navigatr";
import { PortalRetry, portalReachMessage } from "../components/PortalRetry";
import { PortalLabelChip } from "../components/PortalLabelChip";
import {
  PORTAL_POLL_MS,
  PortalApiError,
  isPortalTransientError,
  isPortalUnauthorized,
  portalApi,
  portalDataKey,
} from "../lib/portalApi";
import { formatPortalDate } from "../lib/portalFormat";
import { usePortalSignedIn } from "../lib/portalSignedIn";
import { PORTAL_NOTE_MAX, validateNoteBody } from "../../../../../../supabase/functions/_shared/portalSentApi";

const RATE_LIMITED = "You've added a lot of notes in the last hour. Try again later.";
const GONE = "This referral is no longer available.";
const TOO_LONG = "Keep your note under 1,000 characters.";
const FAILED = "We couldn't add your note. Try again.";
const NO_CONTACT = "No contact details were shared.";

/** A mailto link for one address: everything but the @ is percent-encoded, so a
 *  stored address can never add headers (?cc=, &body=) or a fragment. */
function mailtoHref(email: string): string {
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}`;
}

export function PortalSentReferralPage() {
  const { referralId = "" } = useParams<{ referralId: string }>();
  const { slug, token, brand, expire } = usePortalSignedIn();
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const key = portalDataKey(slug, token, "sent-referral", referralId);
  const q = useQuery({
    queryKey: key,
    queryFn: () => portalApi.getSentReferral(slug, token, referralId),
    refetchInterval: PORTAL_POLL_MS,
    retry: false,
  });

  const unauthorized = isPortalUnauthorized(q.error);
  React.useEffect(() => {
    if (unauthorized) expire();
  }, [unauthorized, expire]);

  const back = (
    <Link
      to={`/p/${slug}/home`}
      className="inline-flex min-h-11 items-center gap-1 self-start text-body-sm text-brand-primary"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden />
      Back to your referrals
    </Link>
  );

  if (unauthorized || q.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
      </div>
    );
  }

  // Retry only when nothing has loaded: a failed background poll keeps the last data.
  if (q.data === undefined) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <PortalRetry name={brand.orgName} onRetry={() => void q.refetch()} busy={q.isFetching} />
      </div>
    );
  }

  if (!q.data) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Card padding="lg" className="flex flex-col gap-2">
          <h1 className="text-heading-lg text-text-default">We couldn&apos;t find that referral</h1>
          <p className="text-body-md text-text-muted">Check the link, or open it from your list.</p>
        </Card>
      </div>
    );
  }

  const r = q.data;
  const sender = r.rep?.name || brand.orgName;
  const body = validateNoteBody(draft);
  const tooLong = body === null && Array.from(draft).length > PORTAL_NOTE_MAX;

  const send = async () => {
    if (body === null) return;
    setBusy(true);
    setNotice(null);
    try {
      await portalApi.postNote(slug, token, r.id, body);
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: key });
    } catch (err) {
      if (isPortalUnauthorized(err)) {
        expire();
        return;
      }
      if (err instanceof PortalApiError && err.code === "rate_limited") setNotice(RATE_LIMITED);
      else if (err instanceof PortalApiError && err.status === 404) {
        // Removed or no longer shared: reload so the page says so instead of a stale composer.
        setNotice(GONE);
        void queryClient.invalidateQueries({ queryKey: key });
      }
      else if (isPortalTransientError(err)) setNotice(portalReachMessage(brand.orgName));
      else setNotice(FAILED);
    } finally {
      setBusy(false);
    }
  };

  const contact: Array<[string, string | null, string | null]> = [
    ["Contact", r.contactName, null],
    ["Email", r.contactEmail, r.contactEmail ? mailtoHref(r.contactEmail) : null],
    ["Phone", r.contactPhone, r.contactPhone ? `tel:${r.contactPhone.replace(/[^\d+]/g, "")}` : null],
  ];
  const shown = contact.filter(([, v]) => v);

  return (
    <div className="flex flex-col gap-4">
      {back}

      <Card padding="lg" className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 break-words text-heading-lg text-text-default">{r.companyName}</h1>
          <PortalLabelChip label={r.label} />
        </div>
        <p className="text-caption text-text-muted">
          {r.ref} · Sent {formatPortalDate(r.sentAt)}
        </p>
      </Card>

      <Card padding="lg">
        <section className="flex flex-col gap-2">
          <h2 className="text-body-strong text-text-default">Sent by {sender}</h2>
          {r.repNote && <p className="whitespace-pre-wrap break-words text-body-md text-text-default">{r.repNote}</p>}
          {r.rep?.email && (
            <a
              href={mailtoHref(r.rep.email)}
              className="inline-flex min-h-11 items-center gap-2 break-all text-body-md text-brand-primary"
            >
              <Mail className="h-4 w-4 shrink-0" aria-hidden />
              {r.rep.email}
            </a>
          )}
        </section>
      </Card>

      <Card padding="lg">
        <section className="flex flex-col gap-2">
          <h2 className="text-body-strong text-text-default">Business contact</h2>
          {r.detailsRemoved && (
            <p className="text-body-md text-text-muted">Contact details for this referral were removed for privacy.</p>
          )}
          {!r.detailsRemoved && shown.length === 0 && <p className="text-body-md text-text-muted">{NO_CONTACT}</p>}
          {shown.length > 0 && (
            <dl className="grid grid-cols-[auto,1fr] items-center gap-x-3 gap-y-1">
              {shown.map(([k, v, href]) => (
                <React.Fragment key={k}>
                  <dt className="text-caption text-text-subtle">{k}</dt>
                  <dd className="break-words text-body-md text-text-default">
                    {href ? (
                      <a href={href} className="inline-flex min-h-11 items-center gap-2 break-all text-brand-primary">
                        {k === "Phone" && <Phone className="h-4 w-4 shrink-0" aria-hidden />}
                        {v}
                      </a>
                    ) : (
                      v
                    )}
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          )}
        </section>
      </Card>

      <Card padding="lg">
        <section className="flex flex-col gap-3">
          <h2 className="text-body-strong text-text-default">Your notes</h2>
          {r.canPostNote && (
            <div className="flex flex-col gap-2">
              <FormField
                label={`Add a note for ${brand.orgName}`}
                htmlFor="portal-sent-note"
                error={tooLong ? TOO_LONG : undefined}
              >
                <Textarea
                  id="portal-sent-note"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  disabled={busy}
                />
              </FormField>
              <p className="text-caption text-text-muted">{sender} gets an email when you add one.</p>
              {notice && (
                <p role="alert" className="text-body-sm text-status-danger">
                  {notice}
                </p>
              )}
              <Button
                variant="primary"
                size="lg"
                fullWidth
                loading={busy}
                disabled={busy || body === null}
                onClick={() => void send()}
              >
                Send note
              </Button>
            </div>
          )}
          {r.notes.length === 0 ? (
            <p className="text-body-md text-text-muted">No notes yet. Let {brand.orgName} know how it&apos;s going.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {r.notes.map((n) => (
                <li key={n.id} className="flex flex-col gap-1">
                  <p className="whitespace-pre-wrap break-words text-body-md text-text-default">{n.body}</p>
                  <time dateTime={n.createdAt} className="text-caption text-text-muted">
                    {formatPortalDate(n.createdAt)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </Card>
    </div>
  );
}
