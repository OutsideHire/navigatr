/**
 * The public referral form (Partner Portal Phase 2B-1, FR-PORT-24..34), at
 * /p/:slug/refer/:token. Anyone with a rep's or the ISO's link can send a
 * business with no sign-in. Built for a phone: one column, big targets.
 *
 * Bot checks are invisible to people: a hidden "website" field, a signed form
 * token the server ages, and a per-connection limit. Past the limit the server
 * asks for a Cloudflare Turnstile check, and only then does this page load the
 * Turnstile script.
 *
 * The form is fetched once (no refetch on focus) and a send waits until the
 * form token is 3.5 seconds old: the server silently drops anything younger
 * than 3 seconds as a bot, and a person must never lose a referral that way.
 */
import * as React from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Unlink } from "lucide-react";
import { Button, Card, Checkbox, FormField, Input, Textarea } from "@/components/navigatr";
import { PortalRetry, portalReachMessage } from "../components/PortalRetry";
import { TurnstileWidget } from "../components/TurnstileWidget";
import {
  PortalApiError,
  isPortalTransientError,
  portalApi,
  type PortalBrand,
  type PortalPublicSubmitInput,
} from "../lib/portalApi";
import { waitForFormAge } from "../lib/publicFormTiming";
import { turnstileSiteKey } from "../lib/turnstile";
import {
  PUBLIC_FORM_LIMITS,
  PUBLIC_HONEYPOT_FIELD,
  isPublicFormField,
  validatePublicSubmission,
  type PublicFormField,
} from "../../../../../../supabase/functions/_shared/portalPublicForm";
import { EMPLOYEE_COUNT_OPTIONS } from "../../../../../../supabase/functions/_shared/portalSubmission";

type Draft = {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
  referredBy: string;
  referrerEmail: string;
  employeeCount: string;
  website: string;
};

const EMPTY: Draft = {
  companyName: "",
  contactName: "",
  email: "",
  phone: "",
  notes: "",
  referredBy: "",
  referrerEmail: "",
  employeeCount: "",
  website: "",
};

const FIELD_MESSAGES: Record<PublicFormField, string> = {
  companyName: "Add the business name.",
  contactName: "Add a contact name.",
  email: "Add a valid email address.",
  phone: "Add a phone number with at least 7 digits.",
  notes: "Add a note about what the business needs.",
  referredBy: "Shorten this to 160 characters or fewer.",
  referrerEmail: "Check your email address, or leave it blank.",
  employeeCount: "Pick a size from the list.",
  consent: "Check the box to confirm you have permission.",
};

const FIELD_IDS: Record<PublicFormField, string> = {
  companyName: "pf-company",
  contactName: "pf-contact",
  email: "pf-email",
  phone: "pf-phone",
  notes: "pf-notes",
  referredBy: "pf-referred-by",
  referrerEmail: "pf-referrer-email",
  employeeCount: "pf-employees",
  consent: "pf-consent",
};

// A native picker, as tall as the lg inputs (44px-or-larger targets).
const SELECT_CLASS =
  "h-12 w-full rounded-radius-md border border-border-default bg-surface-default px-3 text-body-md text-text-default " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary";

const TOO_MANY = "Too many referrals from this connection right now. Try again later.";
const CHECK_PROMPT = "One more step. Complete the check below and we'll send it.";
const CHECK_FAILED = "That check didn't go through. Try it again.";
const CHECK_UNAVAILABLE = "The check couldn't load. Try again later.";
const FORM_EXPIRED = "This page was open for a while. Check your details and send it again.";
const CONSENT_CHANGED = "The wording changed. Please review it and tick the box again.";

function PublicFormUnavailable() {
  return (
    <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
        <Unlink className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="text-heading-lg text-text-default">This form isn&apos;t available</h1>
      <p className="text-body-md text-text-muted">
        Check the link you were given, or ask the person who shared it for a new one.
      </p>
    </Card>
  );
}

export function PortalPublicFormPage({ slug, brand }: { slug: string; brand: PortalBrand }) {
  const { token = "" } = useParams<{ token: string }>();
  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  // The consent version ticked against, or null when unticked.
  const [consentedVersion, setConsentedVersion] = React.useState<number | null>(null);
  const [fieldError, setFieldError] = React.useState<PublicFormField | null>(null);
  // Bumped on every client or server field error, so the same field failing twice
  // still moves focus and re-announces its message.
  const [fieldErrorSeq, setFieldErrorSeq] = React.useState(0);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [captchaKey, setCaptchaKey] = React.useState<number | null>(null);
  const [sentRef, setSentRef] = React.useState<string | null>(null);
  // Whether the sender gave their own email, so a confirmation is on its way.
  const [confirmationSent, setConfirmationSent] = React.useState(false);
  const [gone, setGone] = React.useState(false);
  const inFlight = React.useRef(false);
  const mounted = React.useRef(true);
  // The latest check token, held until it is sent. Tokens are single use.
  const tokenRef = React.useRef<string | null>(null);
  // True while a freshly shown check should send the moment it passes.
  const autoSend = React.useRef(false);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const form = useQuery({
    queryKey: ["portal", "public-form", slug, token],
    queryFn: () => portalApi.publicForm(slug, token),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  React.useEffect(() => {
    if (fieldError !== null) document.getElementById(FIELD_IDS[fieldError])?.focus();
  }, [fieldError, fieldErrorSeq]);

  const pointAt = (field: PublicFormField) => {
    setFieldError(field);
    setFieldErrorSeq((n) => n + 1);
  };

  const update = (key: keyof Draft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const consent = consentedVersion !== null && consentedVersion === form.data?.consentVersion;

  const send = async (fresh?: string) => {
    if (!form.data || inFlight.current) {
      // A check token that arrives now is not lost: the next send uses it.
      if (fresh) tokenRef.current = fresh;
      return;
    }
    const captchaToken = fresh ?? tokenRef.current ?? undefined;
    const input: PortalPublicSubmitInput = {
      ...draft,
      consent,
      consentVersion: consentedVersion ?? form.data.consentVersion,
      formToken: form.data.formToken,
      ...(captchaToken ? { captchaToken } : {}),
    };
    const check = validatePublicSubmission(input);
    if (!check.ok) {
      if (fresh) tokenRef.current = fresh;
      pointAt(check.field);
      setNotice(null);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setFieldError(null);
    setNotice(null);
    try {
      await waitForFormAge(form.dataUpdatedAt);
      if (!mounted.current) return;
      const res = await portalApi.publicSubmit(slug, token, input);
      tokenRef.current = null;
      autoSend.current = false;
      setCaptchaKey(null);
      setConfirmationSent(check.value.referrerEmail !== null);
      setSentRef(res.ref);
    } catch (err) {
      if (!mounted.current) return;
      if (captchaToken) {
        // The token is spent. Drop it and show a fresh check, held for the next send.
        tokenRef.current = null;
        autoSend.current = false;
        setCaptchaKey((k) => (k === null ? null : k + 1));
      }
      if (err instanceof PortalApiError && err.status === 404) {
        setGone(true);
      } else if (err instanceof PortalApiError && err.code === "captcha_required") {
        if (!turnstileSiteKey()) {
          setNotice(TOO_MANY);
        } else {
          setNotice(captchaToken ? CHECK_FAILED : CHECK_PROMPT);
          if (!captchaToken) {
            autoSend.current = true;
            setCaptchaKey((k) => (k ?? 0) + 1);
          }
        }
      } else if (err instanceof PortalApiError && err.status === 429) {
        setNotice(TOO_MANY);
      } else if (err instanceof PortalApiError && err.code === "form_expired") {
        setNotice(FORM_EXPIRED);
        void form.refetch();
      } else if (err instanceof PortalApiError && err.code === "consent_changed") {
        setConsentedVersion(null);
        setNotice(CONSENT_CHANGED);
        void form.refetch();
      } else if (err instanceof PortalApiError && err.status === 400 && isPublicFormField(err.field)) {
        pointAt(err.field);
      } else if (isPortalTransientError(err)) {
        setNotice(portalReachMessage(brand.orgName));
      } else {
        setNotice("We couldn't send that. Try again.");
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  if (form.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
      </div>
    );
  }
  if (form.isError && isPortalTransientError(form.error) && !gone) {
    return <PortalRetry name={brand.orgName} onRetry={() => void form.refetch()} busy={form.isFetching} />;
  }
  if (gone || !form.data) return <PublicFormUnavailable />;

  if (sentRef) {
    return (
      <Card padding="lg" className="flex flex-col gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-status-success-bg text-status-success">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-heading-lg text-text-default">Thanks for the referral</h1>
          <p className="text-body-md text-text-default">{`${brand.orgName} has it. Your reference is ${sentRef}.`}</p>
          {confirmationSent && <p className="text-body-sm text-text-muted">A confirmation email is on its way.</p>}
        </div>
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          onClick={() => {
            setSentRef(null);
            setDraft(EMPTY);
            setConsentedVersion(null);
            setNotice(null);
            void form.refetch();
          }}
        >
          Send another
        </Button>
      </Card>
    );
  }

  const data = form.data;
  const errorFor = (field: PublicFormField): string | undefined =>
    fieldError === field ? FIELD_MESSAGES[field] : undefined;
  // A new key for the field in error remounts its message, so a repeat is announced again.
  const keyFor = (field: PublicFormField): string => (fieldError === field ? `${field}-err-${fieldErrorSeq}` : field);
  const siteKey = turnstileSiteKey();

  return (
    <Card padding="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        noValidate
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-heading-lg text-text-default">{`Refer a business to ${data.orgName}`}</h1>
          <p className="text-body-md text-text-muted">
            {data.repName
              ? `Your referral goes to ${data.repName} at ${data.orgName}.`
              : `Tell ${data.orgName} about a business they can help.`}
          </p>
        </div>

        <FormField label="Business name" key={keyFor("companyName")} htmlFor={FIELD_IDS.companyName} required error={errorFor("companyName")}>
          <Input
            size="lg"
            id={FIELD_IDS.companyName}
            autoComplete="organization"
            maxLength={PUBLIC_FORM_LIMITS.companyName}
            value={draft.companyName}
            onChange={(e) => update("companyName")(e.target.value)}
          />
        </FormField>

        <FormField label="Contact name" key={keyFor("contactName")} htmlFor={FIELD_IDS.contactName} required error={errorFor("contactName")}>
          <Input
            size="lg"
            id={FIELD_IDS.contactName}
            autoComplete="name"
            maxLength={PUBLIC_FORM_LIMITS.contactName}
            value={draft.contactName}
            onChange={(e) => update("contactName")(e.target.value)}
          />
        </FormField>

        <FormField label="Email" key={keyFor("email")} htmlFor={FIELD_IDS.email} required error={errorFor("email")}>
          <Input
            size="lg"
            id={FIELD_IDS.email}
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={PUBLIC_FORM_LIMITS.email}
            value={draft.email}
            onChange={(e) => update("email")(e.target.value)}
          />
        </FormField>

        <FormField label="Phone" key={keyFor("phone")} htmlFor={FIELD_IDS.phone} required error={errorFor("phone")}>
          <Input
            size="lg"
            id={FIELD_IDS.phone}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={PUBLIC_FORM_LIMITS.phone}
            value={draft.phone}
            onChange={(e) => update("phone")(e.target.value)}
          />
        </FormField>

        <FormField label="Notes" key={keyFor("notes")} htmlFor={FIELD_IDS.notes} required error={errorFor("notes")}>
          <Textarea
            className="min-h-11"
            id={FIELD_IDS.notes}
            rows={4}
            maxLength={PUBLIC_FORM_LIMITS.notes}
            placeholder="What does the business need? When is a good time to call?"
            value={draft.notes}
            onChange={(e) => update("notes")(e.target.value)}
          />
        </FormField>

        <FormField
          label="How many employees? (optional)"
          key={keyFor("employeeCount")}
          htmlFor={FIELD_IDS.employeeCount}
          error={errorFor("employeeCount")}
        >
          <select
            id={FIELD_IDS.employeeCount}
            className={SELECT_CLASS}
            value={draft.employeeCount}
            onChange={(e) => update("employeeCount")(e.target.value)}
          >
            <option value="">Choose one</option>
            {EMPLOYEE_COUNT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          label="Who referred this business? (optional)"
          key={keyFor("referredBy")}
          htmlFor={FIELD_IDS.referredBy}
          error={errorFor("referredBy")}
        >
          <Input
            size="lg"
            id={FIELD_IDS.referredBy}
            autoComplete="off"
            maxLength={PUBLIC_FORM_LIMITS.referredBy}
            value={draft.referredBy}
            onChange={(e) => update("referredBy")(e.target.value)}
          />
        </FormField>

        <FormField
          label="Your email (optional)"
          key={keyFor("referrerEmail")}
          htmlFor={FIELD_IDS.referrerEmail}
          helper="For a confirmation. Optional."
          error={errorFor("referrerEmail")}
        >
          <Input
            size="lg"
            id={FIELD_IDS.referrerEmail}
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={PUBLIC_FORM_LIMITS.referrerEmail}
            value={draft.referrerEmail}
            onChange={(e) => update("referrerEmail")(e.target.value)}
          />
        </FormField>

        {/* Honeypot (FR-PORT-30): off screen, out of the tab order, hidden from
            assistive tech. Only bots fill it. */}
        <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
          <label htmlFor="pf-website">Website</label>
          <input
            id="pf-website"
            name={PUBLIC_HONEYPOT_FIELD}
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={draft.website}
            onChange={(e) => update("website")(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Checkbox
            id={FIELD_IDS.consent}
            required
            checked={consent}
            onCheckedChange={(checked) => setConsentedVersion(checked ? data.consentVersion : null)}
            label={data.consentText}
          />
          {fieldError === "consent" && (
            <p key={fieldErrorSeq} role="alert" className="text-caption text-status-danger">
              {FIELD_MESSAGES.consent}
            </p>
          )}
        </div>

        {captchaKey !== null && siteKey && (
          <TurnstileWidget
            key={captchaKey}
            siteKey={siteKey}
            onToken={(captchaToken) => {
              if (autoSend.current) {
                autoSend.current = false;
                void send(captchaToken);
              } else {
                tokenRef.current = captchaToken;
              }
            }}
            onError={() => setNotice(CHECK_UNAVAILABLE)}
          />
        )}

        {notice && (
          <p role="alert" className="text-body-sm text-status-danger">
            {notice}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy} disabled={busy}>
          Send referral
        </Button>
      </form>
    </Card>
  );
}
