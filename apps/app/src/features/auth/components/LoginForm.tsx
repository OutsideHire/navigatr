import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { Button, FormField, Input } from "@/components/navigatr";
import { useAuth } from "@/stores/auth";
import { OAuthButtons, OrDivider } from "./OAuthButtons";

const schema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().optional(),
});

type Values = z.infer<typeof schema>;

/**
 * Two sign-in modes share the same email field:
 *   - "password" (default) — classic email + password
 *   - "magic-link"          — email only, link sent to inbox
 *
 * The toggle is a single text link below the form so the default
 * (password) doesn't add visual noise for the 80% case while still
 * surfacing the faster path one click away. After a magic-link send
 * we swap the whole form for a "check your email" confirmation card.
 */
type Mode = "password" | "magic-link";

export function LoginForm() {
  const signInWithEmail = useAuth((s) => s.signInWithEmail);
  const signInWithMagicLink = useAuth((s) => s.signInWithMagicLink);
  const verifyMagicLinkCode = useAuth((s) => s.verifyMagicLinkCode);
  const navigate = useNavigate();

  const [mode, setMode] = React.useState<Mode>("password");
  // Email we sent the code to. Drives the code-entry UI state — when
  // non-null, we show the 6-digit input instead of the email form.
  const [magicSentTo, setMagicSentTo] = React.useState<string | null>(null);
  const [otpCode, setOtpCode] = React.useState("");
  const [verifying, setVerifying] = React.useState(false);
  // Inline persistent error state for the magic-link send path. Sonner
  // toasts auto-dismiss in a few seconds; users repeatedly missed the
  // failure (especially rate-limit "wait 60s" responses) and thought
  // the button was just broken because the form stayed on the email
  // screen. The inline error survives until the user retries.
  const [sendError, setSendError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    getValues,
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: Values) => {
    if (mode === "magic-link") {
      setSendError(null);
      try {
        await signInWithMagicLink(values.email);
        setMagicSentTo(values.email);
      } catch (err) {
        const raw = err instanceof Error ? err.message : "Couldn't send the code";
        // Friendlier copy for the most common cause: Supabase's per-email
        // rate limit (default 1/60s). The raw message is technical
        // ("For security purposes, you can only request this every 60 seconds")
        // and frequently misread as a security warning. Rewrite to plain
        // English when we can pattern-match.
        const friendly = /every (\d+) seconds?/i.test(raw)
          ? "Hold on — codes can only be requested every 60 seconds. Try again in a moment."
          : /rate limit/i.test(raw)
            ? "Too many requests right now. Try again in a minute."
            : raw;
        setSendError(friendly);
      }
      return;
    }
    // Password mode — require the field at submit time (the schema marks
    // it optional so the magic-link mode can submit without it).
    if (!values.password) {
      setError("password", { message: "Password is required" });
      return;
    }
    try {
      await signInWithEmail(values.email, values.password);
      navigate("/dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    }
  };

  // ── Post-magic-link: enter the 6-digit code from the email ───────
  if (magicSentTo) {
    const handleVerify = async (e?: React.FormEvent) => {
      e?.preventDefault();
      const code = otpCode.replace(/\D/g, "");
      // Supabase OTP length is project-configurable: 6, 7, 8, 9, or 10
      // digits (default 6). We accept anything in that range — server-side
      // verifyOtp is the authoritative validator. Hard-coded 6 here
      // silently truncated 8-digit codes for projects with the longer
      // setting, producing a misleading "expired or invalid" error.
      if (code.length < 6 || code.length > 10) {
        toast.error("Enter the code from your email");
        return;
      }
      setVerifying(true);
      try {
        await verifyMagicLinkCode(magicSentTo, code);
        navigate("/dashboard");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't verify code");
      } finally {
        setVerifying(false);
      }
    };

    return (
      <form onSubmit={handleVerify} className="flex flex-col items-center gap-4 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-brand-primary-10 text-brand-primary">
          <Mail className="h-6 w-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-heading-sm text-text-default">Check your inbox</h2>
          <p className="text-body-md text-text-muted">
            We sent a 6-digit code to{" "}
            <span className="font-medium text-text-default">{magicSentTo}</span>.
          </p>
        </div>

        <FormField label="Verification code" htmlFor="otp-code" showLabel={false}>
          <Input
            id="otp-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="12345678"
            // Cap at 10 digits — Supabase's max OTP length. Length is
            // project-configurable; the actual valid length is whatever
            // the email shows. We strip non-digits but don't enforce a
            // specific count client-side.
            maxLength={10}
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
            className="text-center text-heading-sm tracking-[0.4em] tabular-nums"
          />
        </FormField>

        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={verifying}
          disabled={otpCode.length < 6 || verifying}
        >
          {verifying ? "Verifying…" : "Sign in"}
        </Button>

        <p className="text-caption text-text-subtle">
          Didn&apos;t get it? Check spam, or{" "}
          <button
            type="button"
            onClick={() => {
              setMagicSentTo(null);
              setOtpCode("");
              setMode("magic-link");
            }}
            className="font-medium text-brand-primary underline-offset-4 hover:underline"
          >
            send another
          </button>
          .
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
      <OAuthButtons disabled={isSubmitting} consentNote />
      <OrDivider />

      <FormField label="Work email" htmlFor="login-email" error={errors.email?.message}>
        <Input
          type="email"
          autoComplete="email"
          autoFocus
          placeholder="you@company.com"
          {...register("email")}
        />
      </FormField>

      {/* Password field only appears in password mode. Magic-link mode
          skips it — the email is the only credential needed. */}
      {mode === "password" && (
        <>
          <FormField label="Password" htmlFor="login-password" error={errors.password?.message}>
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              {...register("password")}
            />
          </FormField>

          <div className="-mt-2 flex justify-end">
            <Link
              to="/forgot-password"
              className="text-caption text-brand-primary underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        </>
      )}

      {/* Inline send-error — persists until the user retries / toggles modes.
          Sonner toasts auto-dismiss; users were missing rate-limit failures
          and assumed the button was broken. */}
      {sendError && (
        <div
          role="alert"
          className="rounded-radius-md border border-status-danger/30 bg-status-danger-bg/50 p-3 text-body-sm text-status-danger"
        >
          {sendError}
        </div>
      )}

      <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
        {isSubmitting
          ? mode === "magic-link" ? "Sending code…" : "Signing in…"
          : mode === "magic-link" ? "Email me a sign-in code" : "Sign in"}
      </Button>

      {/* Mode toggle — single text link. Keeps the password path as the
          default (familiar) while making magic link one click away. */}
      <div className="-mt-2 text-center">
        <button
          type="button"
          onClick={() => {
            setMode(mode === "password" ? "magic-link" : "password");
            setSendError(null);
          }}
          className="text-caption text-brand-primary underline-offset-4 hover:underline"
        >
          {mode === "password"
            ? "Sign in without a password"
            : "Use a password instead"}
        </button>
      </div>

      <p className="text-center text-body-md text-text-muted">
        New to navigatr?{" "}
        <Link to="/signup" className="font-medium text-brand-primary underline-offset-4 hover:underline">
          Sign up
        </Link>
      </p>

      {/* Hidden hint for forms autofill — when the user toggles modes,
          their email shouldn't get wiped. RHF preserves it because
          the field stays mounted; this comment is just a load-bearing
          reminder for future refactors NOT to remount the email field. */}
      <input type="hidden" value={getValues("email")} />
    </form>
  );
}
