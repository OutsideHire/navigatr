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
import { Button, FormField, Input } from "@/components/navigatr";
import { useAuth } from "@/stores/auth";
import { supabase } from "@/lib/supabase";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
  fullName: z.string().trim().min(2, "Enter your name"),
});
type Values = z.infer<typeof schema>;

export function AcceptInvitePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const signUp = useAuth((s) => s.signUp);
  const user = useAuth((s) => s.user);

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

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", fullName: "" },
  });

  const onSubmit = async (values: Values) => {
    if (!token) {
      toast.error("Missing invite token");
      return;
    }
    try {
      await signUp(values.email, values.password, values.fullName, token);
      navigate("/auth/callback");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign up failed");
    }
  };

  return (
    <AuthSplitShell
      title="You're invited."
      subtitle="Finish setting up your account."
      heroEyebrow="Welcome to navigatr"
      heroTitle="Two minutes to your pipeline."
      heroBody="Set up your account and start logging activities."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        <FormField label="Full name" htmlFor="ai-name" error={errors.fullName?.message}>
          <Input id="ai-name" autoFocus {...register("fullName")} />
        </FormField>
        <FormField label="Work email" htmlFor="ai-email" error={errors.email?.message}>
          <Input id="ai-email" type="email" autoComplete="email" {...register("email")} />
        </FormField>
        <FormField label="Password" htmlFor="ai-pw" error={errors.password?.message} helper="At least 8 characters.">
          <Input id="ai-pw" type="password" autoComplete="new-password" {...register("password")} />
        </FormField>
        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>Create my account</Button>
      </form>
    </AuthSplitShell>
  );
}
export default AcceptInvitePage;
