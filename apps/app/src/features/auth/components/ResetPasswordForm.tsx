import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button, FormField, Input } from "@/components/navigatr";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

const schema = z
  .object({
    password: z.string().min(8, "At least 8 characters"),
    confirm: z.string().min(8, "At least 8 characters"),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

type Values = z.infer<typeof schema>;

/**
 * Three render paths gated on the recovery session being live:
 *
 *   "checking"  → spinner while we wait for the PKCE code-exchange that
 *                 supabase-js does automatically when the page loads with
 *                 ?code= in the URL. Submitting the form before this
 *                 finishes returned "Auth session missing!" — the bug
 *                 robert hit.
 *
 *   "ready"     → real form. Session is established, updateUser will work.
 *
 *   "expired"   → no session arrived. The recovery token is one-shot —
 *                 second click after a successful reset, or after the
 *                 1-hour expiry, gets here. Helpful "request a new link"
 *                 CTA instead of an alarming error.
 */
type Status = "checking" | "ready" | "expired";

/** Cap how long we wait for the code exchange before deciding the link
 *  is dead. PKCE exchange normally takes 100-300ms; 4 seconds is more
 *  than generous and prevents an indefinite spinner on a stale link. */
const SESSION_CHECK_TIMEOUT_MS = 4000;

export function ResetPasswordForm() {
  const updatePassword = useAuth((s) => s.updatePassword);
  const navigate = useNavigate();
  const [status, setStatus] = React.useState<Status>("checking");

  React.useEffect(() => {
    let cancelled = false;

    // Subscribe FIRST so we don't miss the auth event Supabase fires when
    // the PKCE code-for-session exchange completes. Recovery flows emit
    // either PASSWORD_RECOVERY or SIGNED_IN (varies by Supabase version).
    const sub = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setStatus("ready");
      }
    });

    // Initial probe: getUser() instead of getSession(). getSession() is
    // local-only — it returns a stale session sitting in localStorage even
    // if it's expired server-side. getUser() validates against Supabase,
    // so a stale token returns an error and we stay in "checking" until
    // the timer flips us to "expired".
    //
    // The bug this caught (robert@getnavigatr.io, screenshot in PR
    // description): his localStorage held a session from days ago. The
    // form rendered as "ready", he typed his new password, hit submit,
    // updateUser sent the stale access token to the server, server
    // returned 401 = "Auth session missing!" toast. The form looked
    // fine the whole time. With getUser(), we'd have stayed in checking
    // and eventually shown the "send a new link" CTA truthfully.
    void supabase.auth.getUser().then(({ data, error }) => {
      if (cancelled) return;
      if (!error && data.user) setStatus("ready");
    });

    // Failure path: no session, no event, no valid user. Recovery token
    // was probably already consumed (single-use) or expired (1h default).
    const timer = setTimeout(() => {
      if (cancelled) return;
      setStatus((current) => (current === "checking" ? "expired" : current));
    }, SESSION_CHECK_TIMEOUT_MS);

    return () => {
      cancelled = true;
      sub.data.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });

  const onSubmit = async (values: Values) => {
    try {
      await updatePassword(values.password);
      toast.success("Password updated. Welcome back.");
      navigate("/dashboard");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't update password";
      // If Supabase says "Auth session missing" at submit time despite
      // our server-validated check at mount, the session lapsed between
      // mount and click (uncommon — but a 4-second tab where the user
      // walked away matters). Flip to expired so they get the "send a
      // new link" recovery instead of a sticky toast.
      if (/auth session missing/i.test(msg)) {
        setStatus("expired");
        return;
      }
      toast.error(msg);
    }
  };

  if (status === "checking") {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-hidden />
        <p className="text-body-md text-text-muted">Verifying your reset link…</p>
      </div>
    );
  }

  if (status === "expired") {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <p className="text-body-strong text-text-default">This reset link is no longer valid.</p>
        <p className="text-body-md text-text-muted">
          Reset links expire after an hour and can only be used once.
        </p>
        <Link
          to="/forgot-password"
          className="mt-2 inline-flex h-10 items-center rounded-radius-md bg-brand-primary px-4 text-sm font-medium text-text-inverse"
        >
          Send a new link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
      <FormField label="New password" htmlFor="reset-password" error={errors.password?.message}>
        <Input
          type="password"
          autoComplete="new-password"
          autoFocus
          placeholder="At least 8 characters"
          {...register("password")}
        />
      </FormField>

      <FormField label="Confirm new password" htmlFor="reset-confirm" error={errors.confirm?.message}>
        <Input
          type="password"
          autoComplete="new-password"
          placeholder="Re-enter password"
          {...register("confirm")}
        />
      </FormField>

      <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
        {isSubmitting ? "Updating…" : "Reset password"}
      </Button>
    </form>
  );
}
