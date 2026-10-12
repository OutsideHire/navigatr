/**
 * Send a referral (spec 5.5, FR-PORT-35..43). Built for a phone: one column,
 * native pickers, big targets. The draft saves on every change and clears on a
 * successful send. Consent uses the ISO's wording and version from the server
 * (brief D4). While typing, a soft duplicate check may say the business could
 * already be in progress; it never says with whom, and it never blocks (brief
 * D3). Notes can be dictated through portal_api (brief D6). Address is plain
 * text in this phase (brief D7).
 */
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, Loader2 } from "lucide-react";
import { Button, Card, Checkbox, FormField, Input, NotesFieldWithMic } from "@/components/navigatr";
import { appendDictated } from "@/hooks/useVoiceDictation";
import { portalReachMessage } from "../components/PortalRetry";
import { usePortalDictation } from "../hooks/usePortalDictation";
import {
  PortalApiError,
  isPortalTransientError,
  isPortalUnauthorized,
  portalApi,
  portalDataKey,
  type PortalSubmitInput,
  type PortalSubmitted,
} from "../lib/portalApi";
import { EMPTY_DRAFT, clearPortalDraft, readPortalDraft, writePortalDraft, type PortalDraft } from "../lib/portalDraft";
import { usePortalSignedIn } from "../lib/portalSignedIn";
import {
  PORTAL_FIELD_LIMITS,
  PORTAL_INDUSTRIES,
  PORTAL_URGENCIES,
  isSubmissionField,
  validateSubmission,
  type PortalSubmissionField,
} from "../../../../../../supabase/functions/_shared/portalSubmission";

const FIELD_MESSAGES: Record<PortalSubmissionField, string> = {
  companyName: "Add the business name.",
  contactName: "Add a contact name.",
  email: "Check the email address.",
  phone: "Check the phone number.",
  emailOrPhone: "Add an email or a phone number.",
  address: "Shorten the address.",
  industry: "Pick an industry from the list.",
  urgency: "Pick a timing from the list.",
  notes: "Shorten the notes.",
  consent: "Check the box to confirm you have permission.",
};

const TOO_MANY = "Too many referrals right now. Try again later.";
const DICTATION_ERROR = "Couldn't turn that into text. Try a shorter clip in a minute, or type it.";
const DICTATION_TOO_LONG = "That clip is too long. Keep it under about 2 minutes.";
const CONSENT_CHANGED = "The wording changed. Please review it and tick the box again.";

const FIELD_IDS: Record<PortalSubmissionField, string> = {
  companyName: "portal-company",
  contactName: "portal-contact",
  email: "portal-email-field",
  phone: "portal-phone",
  emailOrPhone: "portal-email-field",
  address: "portal-address",
  industry: "portal-industry",
  urgency: "portal-urgency",
  notes: "portal-notes",
  consent: "portal-consent",
};

const SELECT_CLASS =
  "h-11 w-full rounded-radius-md border border-border-default bg-surface-default px-3 text-body-md text-text-default " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary";

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function PortalSubmitPage() {
  const { slug, token, brand, expire } = usePortalSignedIn();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState<PortalDraft>(() => readPortalDraft(slug));
  // The consent version the partner ticked against, or null when unticked.
  // What is sent is this captured version, never whatever the form shows now.
  const [consentedVersion, setConsentedVersion] = React.useState<number | null>(null);
  const [fieldError, setFieldError] = React.useState<PortalSubmissionField | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState<(PortalSubmitted & { companyName: string }) | null>(null);

  React.useEffect(() => {
    writePortalDraft(slug, draft);
  }, [slug, draft]);

  // Point at the first problem: move focus to the field the check or the server named.
  React.useEffect(() => {
    if (fieldError !== null) document.getElementById(FIELD_IDS[fieldError])?.focus();
  }, [fieldError]);

  const update = (key: keyof PortalDraft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const form = useQuery({
    queryKey: portalDataKey(slug, token, "form"),
    queryFn: () => portalApi.form(slug, token),
    retry: false,
    staleTime: 5 * 60_000,
  });

  // Soft duplicate check: after a company plus a phone or an email, debounced.
  const name = draft.companyName.trim();
  const phone = draft.phone.trim();
  const email = draft.email.trim();
  const address = draft.address.trim();
  const ready = name !== "" && (phone !== "" || email !== "");
  const dupKey = useDebouncedValue(ready ? JSON.stringify([name, phone, address]) : "", 500);
  const dup = useQuery({
    queryKey: portalDataKey(slug, token, "dup", dupKey),
    queryFn: () => {
      const [n, p, a] = JSON.parse(dupKey) as [string, string, string];
      return portalApi.dupCheck(slug, token, { companyName: n, phone: p, address: a });
    },
    enabled: dupKey !== "" && sent === null,
    retry: false,
    staleTime: 60_000,
  });
  const showDup = ready && dup.data === true;

  // A failed background refetch keeps the loaded form; only a form that never loaded gets a retry.
  const unauthorized = isPortalUnauthorized(form.error) || isPortalUnauthorized(dup.error);
  React.useEffect(() => {
    if (unauthorized) expire();
  }, [unauthorized, expire]);

  // The ticked version must match the wording on screen. When a refresh brings
  // new wording, untick and ask again before anything can be sent.
  const consentVersion = form.data?.consentVersion;
  const consent = consentedVersion !== null && consentedVersion === consentVersion;
  React.useEffect(() => {
    if (consentVersion === undefined || consentedVersion === null || consentedVersion === consentVersion) return;
    setConsentedVersion(null);
    setNotice(CONSENT_CHANGED);
  }, [consentVersion, consentedVersion]);

  const dictation = usePortalDictation({
    slug,
    token,
    onResult: (text) => setDraft((d) => ({ ...d, notes: appendDictated(d.notes, text) })),
    onUnauthorized: expire,
  });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.data || busy) return;
    const input: PortalSubmitInput = {
      ...draft,
      consent,
      consentVersion: consentedVersion ?? form.data.consentVersion,
    };
    const check = validateSubmission(input);
    if (!check.ok) {
      setFieldError(check.field);
      setNotice(null);
      return;
    }
    setBusy(true);
    setFieldError(null);
    setNotice(null);
    try {
      const res = await portalApi.submitReferral(slug, token, input);
      clearPortalDraft(slug);
      setDraft({ ...EMPTY_DRAFT });
      setConsentedVersion(null);
      setSent({ ...res, companyName: check.value.companyName });
      void queryClient.invalidateQueries({ queryKey: portalDataKey(slug, token, "dashboard") });
      void queryClient.invalidateQueries({ queryKey: portalDataKey(slug, token, "list") });
    } catch (err) {
      if (isPortalUnauthorized(err)) {
        expire();
        return;
      }
      if (err instanceof PortalApiError && err.code === "consent_changed") {
        setConsentedVersion(null);
        setNotice(CONSENT_CHANGED);
        void form.refetch();
      } else if (err instanceof PortalApiError && err.status === 400 && isSubmissionField(err.field)) {
        setFieldError(err.field);
      } else if (err instanceof PortalApiError && err.status === 429) {
        setNotice(TOO_MANY);
      } else if (isPortalTransientError(err)) {
        setNotice(portalReachMessage(brand.orgName));
      } else {
        setNotice("We couldn't send that. Try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Card padding="lg" className="flex flex-col gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-status-success-bg text-status-success">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-heading-lg text-text-default">Referral sent</h1>
          <p className="text-body-md text-text-default">
            {brand.orgName} has {sent.companyName}. Your reference is {sent.ref}.
          </p>
        </div>
        <Button variant="primary" size="lg" fullWidth onClick={() => navigate(`/p/${slug}/r/${sent.id}`)}>
          View this referral
        </Button>
        <Button variant="secondary" size="lg" fullWidth onClick={() => setSent(null)}>
          Send another
        </Button>
        <Button variant="tertiary" size="lg" onClick={() => navigate(`/p/${slug}/home`)}>
          Back to your referrals
        </Button>
      </Card>
    );
  }

  const errorFor = (...fields: PortalSubmissionField[]): string | undefined =>
    fieldError !== null && fields.includes(fieldError) ? FIELD_MESSAGES[fieldError] : undefined;

  let consentBlock: React.ReactNode;
  if (form.data) {
    consentBlock = (
      <Checkbox
        id="portal-consent"
        checked={consent}
        onCheckedChange={(checked) => setConsentedVersion(checked ? (form.data?.consentVersion ?? null) : null)}
        label={form.data.consentText}
      />
    );
  } else if (form.isPending) {
    consentBlock = <Loader2 className="h-5 w-5 animate-spin text-text-subtle" aria-label="Loading" />;
  } else {
    consentBlock = (
      <div className="flex flex-col gap-2">
        <p className="text-body-sm text-status-danger">{portalReachMessage(brand.orgName)}</p>
        <Button type="button" variant="secondary" size="lg" loading={form.isFetching} onClick={() => void form.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        to={`/p/${slug}/home`}
        className="inline-flex min-h-11 items-center gap-1 self-start text-body-sm text-brand-primary"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Back to your referrals
      </Link>
      <Card padding="lg">
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-heading-lg text-text-default">Send a referral</h1>
            <p className="text-body-md text-text-muted">Tell {brand.orgName} about a business they can help.</p>
          </div>

          <FormField label="Business name" htmlFor="portal-company" error={errorFor("companyName")}>
            <Input
              id="portal-company"
              autoComplete="organization"
              maxLength={PORTAL_FIELD_LIMITS.companyName}
              value={draft.companyName}
              onChange={(e) => update("companyName")(e.target.value)}
            />
          </FormField>

          <FormField label="Contact name" htmlFor="portal-contact" error={errorFor("contactName")}>
            <Input
              id="portal-contact"
              autoComplete="off"
              maxLength={PORTAL_FIELD_LIMITS.contactName}
              value={draft.contactName}
              onChange={(e) => update("contactName")(e.target.value)}
            />
          </FormField>

          <FormField label="Email" htmlFor="portal-email-field" error={errorFor("email")}>
            <Input
              id="portal-email-field"
              type="email"
              inputMode="email"
              autoComplete="off"
              maxLength={PORTAL_FIELD_LIMITS.email}
              value={draft.email}
              onChange={(e) => update("email")(e.target.value)}
            />
          </FormField>

          <FormField
            label="Phone"
            htmlFor="portal-phone"
            helper="Add an email, a phone number, or both."
            error={errorFor("phone", "emailOrPhone")}
          >
            <Input
              id="portal-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={PORTAL_FIELD_LIMITS.phone}
              value={draft.phone}
              onChange={(e) => update("phone")(e.target.value)}
            />
          </FormField>

          {showDup && (
            <p role="status" className="rounded-radius-sm bg-status-warning-bg p-3 text-body-sm text-status-warning">
              This business may already be in progress with {brand.orgName}. You can still send it.
            </p>
          )}

          <FormField label="Address (optional)" htmlFor="portal-address" error={errorFor("address")}>
            <Input
              id="portal-address"
              autoComplete="off"
              maxLength={PORTAL_FIELD_LIMITS.address}
              value={draft.address}
              onChange={(e) => update("address")(e.target.value)}
            />
          </FormField>

          <FormField label="Industry (optional)" htmlFor="portal-industry" error={errorFor("industry")}>
            <select
              id="portal-industry"
              className={SELECT_CLASS}
              value={draft.industry}
              onChange={(e) => update("industry")(e.target.value)}
            >
              <option value="">Choose one</option>
              {PORTAL_INDUSTRIES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="How soon? (optional)" htmlFor="portal-urgency" error={errorFor("urgency")}>
            <select
              id="portal-urgency"
              className={SELECT_CLASS}
              value={draft.urgency}
              onChange={(e) => update("urgency")(e.target.value)}
            >
              <option value="">Choose one</option>
              {PORTAL_URGENCIES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Notes (optional)" htmlFor="portal-notes" error={errorFor("notes")}>
            <NotesFieldWithMic
              id="portal-notes"
              value={draft.notes}
              onChange={update("notes")}
              placeholder="Anything that will help, like the best time to call."
              maxLength={PORTAL_FIELD_LIMITS.notes}
              rows={4}
              onMicClick={dictation.toggle}
              micState={dictation.micState}
              errorMessage={dictation.tooLong ? DICTATION_TOO_LONG : DICTATION_ERROR}
            />
          </FormField>

          <div className="flex flex-col gap-1">
            {consentBlock}
            {fieldError === "consent" && (
              <p role="alert" className="text-caption text-status-danger">
                {FIELD_MESSAGES.consent}
              </p>
            )}
          </div>

          {notice && (
            <p role="alert" className="text-body-sm text-status-danger">
              {notice}
            </p>
          )}

          <Button type="submit" variant="primary" size="lg" fullWidth loading={busy} disabled={busy || !form.data}>
            Send referral
          </Button>
        </form>
      </Card>
    </div>
  );
}
