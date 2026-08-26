/**
 * /accept-invite?token=<org_invites.token>
 *
 * Flow:
 *   1. Read token from URL.
 *   2. If user is already signed in: call claim_invite_code with the token.
 *      → On success, profile is created/linked; route to /dashboard.
 *   3. If NOT signed in: show signup form (email pre-filled from URL? No —
 *      we don't expose the email; agent enters it. The token validates the
 *      pairing server-side.)
 *      → On signup, signUp() with the token in user_metadata.invite_code;
 *        AuthCallbackPage will call claim_invite_code, which finds the
 *        token row, sets accepted_at, creates the profile.
 *
 * In practice, the agent clicks the invite email link → they're NOT signed
 * in → they hit branch 3 → signup → auto-login → /auth/callback → claim →
 * /dashboard. That's the canonical path; branch 2 covers the edge case
 * where the agent had a session for an unrelated org and clicked a link.
 */
import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AuthSplitShell } from "../components/AuthShell";
import { CheckYourEmailNotice } from "../components/CheckYourEmailNotice";
import { Button, FormField, Input } from "@/components/navigatr";
import { useAuth } from "@/stores/auth";
import { supabase } from "@/lib/supabase";
import { ROLE_LEVEL_OPTIONS, type RoleLevel } from "@/features/auth/capabilities";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
  fullName: z.string().trim().min(2, "Enter your name"),
});
type Values = z.infer<typeof schema>;

/** Minimal invite context shown before sign-in (from the peek_invite RPC). */
interface InviteMeta {
  org_name: string;
  role_level: RoleLevel | null;
  inviter_name: string | null;
  invitee_email: string;
  invitee_full_name: string | null;
}

export function AcceptInvitePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const signUp = useAuth((s) => s.signUp);
  const user = useAuth((s) => s.user);
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [peek, setPeek] = React.useState<{ status: "loading" | "ok" | "invalid"; data?: InviteMeta }>({
    status: "loading",
  });

  // If somehow signed in already, run claim and bounce.
  React.useEffect(() => {
    if (!user || !token) return;
    (async () => {
      const { error } = await supabase.rpc("claim_invite_code", { p_code: token });
      if (error) {
        toast.error(error.message);
        return;
      }
      navigate("/dashboard", { replace: true });
    })();
  }, [user, token, navigate]);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", fullName: "" },
  });

  // Not signed in: look up who/org/role by token so the screen has real context
  // and the invited email is pre-filled. peek_invite returns nothing for an
  // invalid / expired / already-accepted / revoked token.
  React.useEffect(() => {
    if (user) return; // signed-in users are handled by the claim effect above
    if (!token) {
      setPeek({ status: "invalid" });
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc("peek_invite", { p_token: token });
      if (cancelled) return;
      const row = (Array.isArray(data) ? data[0] : data) as InviteMeta | undefined;
      if (error || !row) {
        setPeek({ status: "invalid" });
        return;
      }
      setPeek({ status: "ok", data: row });
      reset({ email: row.invitee_email, fullName: row.invitee_full_name ?? "", password: "" });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, token, reset]);

  const onSubmit = async (values: Values) => {
    if (!token) {
      toast.error("Missing invite token");
      return;
    }
    try {
      // Stash the token so AuthCallbackPage can find it after signUp.
      // signUp also puts the token in user_metadata.invite_code, but the
      // callback page reads from sessionStorage / URL, not user_metadata.
      // Matches the same pattern OAuth uses (where state is lost across
      // the auth-provider hop).
      sessionStorage.setItem("pending_invite", token);
      const { needsEmailConfirmation, alreadyRegistered } = await signUp(values.email, values.password, values.fullName, token);
      // Already have an account: signing up sends no email, so don't strand
      // them on "check your email". Send them to sign in. (Drop the stashed
      // token so it can't be claimed spuriously later.)
      if (alreadyRegistered) {
        sessionStorage.removeItem("pending_invite");
        toast.error("You already have an account. Please sign in to accept the invite.");
        navigate("/login");
        return;
      }
      // Confirmation ON: show "check your email". The token also rides in
      // user_metadata, so AuthCallbackPage can claim it after confirmation even
      // if the link opens in a new tab (see resolveInviteCode). Confirmation
      // OFF: signed in already, go straight to the callback to claim + land.
      if (needsEmailConfirmation) {
        setSentTo(values.email);
        return;
      }
      navigate("/auth/callback");
    } catch (err) {
      sessionStorage.removeItem("pending_invite");
      toast.error(err instanceof Error ? err.message : "Sign up failed");
    }
  };

  const roleLabel =
    (peek.data?.role_level && ROLE_LEVEL_OPTIONS.find((o) => o.value === peek.data!.role_level)?.label) ||
    "teammate";

  return (
    <AuthSplitShell
      title="You're invited."
      subtitle="Finish setting up your account."
      heroEyebrow="Welcome to navigatr"
      heroTitle="Two minutes to your pipeline."
      heroBody="Set up your account and start logging activities."
    >
      {sentTo ? (
        <CheckYourEmailNotice email={sentTo} />
      ) : peek.status === "loading" ? (
        <p className="text-body-md text-text-muted">Loading your invite…</p>
      ) : peek.status === "invalid" ? (
        <div className="flex flex-col gap-3 text-center">
          <h2 className="text-heading-md text-text-default">This invite link isn&apos;t valid</h2>
          <p className="text-body-md text-text-muted">
            It may have expired or already been used. Ask your administrator to resend it.
          </p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="text-body-sm font-medium text-brand-primary underline underline-offset-2"
          >
            Go to sign in
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Trust context: who invited them, which org, what role. */}
          <div className="rounded-radius-md border border-border-subtle bg-surface-sunken p-4">
            <p className="text-body-md text-text-default">
              {peek.data?.inviter_name ? (
                <>
                  <span className="font-medium">{peek.data.inviter_name}</span> invited you to join{" "}
                </>
              ) : (
                "You've been invited to join "
              )}
              <span className="font-medium">{peek.data?.org_name}</span> as a{" "}
              <span className="font-medium">{roleLabel}</span>.
            </p>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
            <FormField label="Full name" htmlFor="ai-name" error={errors.fullName?.message}>
              <Input id="ai-name" autoFocus {...register("fullName")} />
            </FormField>
            <FormField label="Work email" htmlFor="ai-email" error={errors.email?.message} helper="From your invite.">
              <Input id="ai-email" type="email" autoComplete="email" readOnly {...register("email")} />
            </FormField>
            <FormField label="Password" htmlFor="ai-pw" error={errors.password?.message} helper="At least 8 characters.">
              <Input id="ai-pw" type="password" autoComplete="new-password" {...register("password")} />
            </FormField>
            <Button type="submit" size="lg" fullWidth loading={isSubmitting}>Create my account</Button>
          </form>
        </div>
      )}
    </AuthSplitShell>
  );
}
export default AcceptInvitePage;
