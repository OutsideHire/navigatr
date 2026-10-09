/**
 * Partner sign-in (spec 5.3, R1): email, then a 6-digit code. The server always
 * answers the same way whether or not the email has access (NFR-PORT-04), so
 * this page never says "no account found".
 */
import * as React from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Mail } from "lucide-react";
import { Button, Card, FormField, Input } from "@/components/navigatr";
import { PortalApiError, isPortalTransientError, portalApi, type PortalBrand } from "../lib/portalApi";
import { portalReachMessage } from "../components/PortalRetry";
import { readPortalSession, writePortalSession } from "../lib/portalSession";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PortalSignInPage({ slug, brand }: { slug: string; brand: PortalBrand }) {
  const navigate = useNavigate();
  const [existing] = React.useState(() => readPortalSession(slug));
  const [step, setStep] = React.useState<"email" | "code">("email");
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Set when the last attempt failed to reach the server; offers a Try again.
  const [retry, setRetry] = React.useState<(() => void) | null>(null);

  if (existing) return <Navigate to={`/p/${slug}/home`} replace />;

  const doSendCode = async () => {
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);
    setRetry(null);
    try {
      await portalApi.requestCode(slug, trimmed);
      setCode("");
      setStep("code");
    } catch (err) {
      if (isPortalTransientError(err)) {
        setError(portalReachMessage(brand.orgName));
        setRetry(() => () => void doSendCode());
      } else {
        setError("We couldn't send a code. Try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const doVerify = async () => {
    setBusy(true);
    setError(null);
    setRetry(null);
    try {
      const session = await portalApi.verifyCode(slug, email.trim(), code);
      writePortalSession(slug, session.sessionToken);
      navigate(`/p/${slug}/home`, { replace: true });
    } catch (err) {
      if (isPortalTransientError(err)) {
        setError(portalReachMessage(brand.orgName));
        setRetry(() => () => void doVerify());
      } else {
        setError(
          err instanceof PortalApiError && err.status === 401
            ? "That code didn't work. Check it, or send a new one."
            : "We couldn't sign you in. Try again.",
        );
      }
      setBusy(false);
    }
  };

  const sendCode = (e: React.FormEvent) => {
    e.preventDefault();
    void doSendCode();
  };

  const verify = (e: React.FormEvent) => {
    e.preventDefault();
    void doVerify();
  };

  const retryButton = retry && (
    <Button type="button" variant="secondary" size="md" disabled={busy} onClick={retry}>
      Try again
    </Button>
  );

  if (step === "code") {
    return (
      <Card padding="lg">
        <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
          <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-brand-primary-10 text-brand-primary">
            <Mail className="h-6 w-6" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="text-heading-lg text-text-default">Check your email</h1>
            <p className="text-body-md text-text-muted">
              If {email.trim()} has access, we sent a 6-digit code. It works for 15 minutes.
            </p>
          </div>
          <FormField label="6-digit code" htmlFor="portal-code">
            <Input
              id="portal-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="text-center text-heading-sm tracking-[0.4em] tabular-nums"
            />
          </FormField>
          {error && (
            <p role="alert" className="text-body-sm text-status-danger">
              {error}
            </p>
          )}
          {retryButton}
          <Button type="submit" size="lg" fullWidth loading={busy} disabled={code.length !== 6 || busy}>
            Sign in
          </Button>
          <Button
            type="button"
            variant="tertiary"
            size="md"
            onClick={() => {
              setStep("email");
              setError(null);
              setRetry(null);
            }}
          >
            Send a new code
          </Button>
        </form>
      </Card>
    );
  }

  return (
    <Card padding="lg">
      <form onSubmit={sendCode} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1">
          <h1 className="text-heading-lg text-text-default">Sign in to {brand.orgName}</h1>
          <p className="text-body-md text-text-muted">
            Use the email {brand.orgName} invited. We&apos;ll send you a 6-digit code.
          </p>
        </div>
        <FormField label="Email" htmlFor="portal-email">
          <Input
            id="portal-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>
        {error && (
          <p role="alert" className="text-body-sm text-status-danger">
            {error}
          </p>
        )}
        {retryButton}
        <Button type="submit" size="lg" fullWidth loading={busy} disabled={busy}>
          Email me a code
        </Button>
      </form>
    </Card>
  );
}
