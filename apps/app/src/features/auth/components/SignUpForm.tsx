import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button, FormField, Input } from "@/components/navigatr";
import { useAuth } from "@/stores/auth";
import { OAuthButtons, OrDivider } from "./OAuthButtons";
import { CheckYourEmailNotice } from "./CheckYourEmailNotice";

const schema = z.object({
  fullName: z.string().trim().min(2, "Please enter your full name"),
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "At least 8 characters"),
  // Optional — blank means "create a new workspace" (self-serve path).
  // The auth callback routes profile-less users to /create-organization.
  inviteCode: z.string().trim().optional().default(""),
});

type Values = z.infer<typeof schema>;

export function SignUpForm() {
  const signUp = useAuth((s) => s.signUp);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const codeFromUrl = params.get("code") ?? "";
  const [sentTo, setSentTo] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: "", email: "", password: "", inviteCode: codeFromUrl },
  });

  const inviteCode = watch("inviteCode");

  const onSubmit = async (values: Values) => {
    try {
      const { needsEmailConfirmation, alreadyRegistered } = await signUp(
        values.email, values.password, values.fullName, values.inviteCode.trim(),
      );
      // Email already has an account (Supabase sends no email in this case):
      // point them to sign in rather than a "check your email" that never comes.
      if (alreadyRegistered) {
        toast.error("An account with this email already exists. Please sign in.");
        navigate("/login");
        return;
      }
      // Confirmation ON: no session yet, so show "check your email" instead of
      // bouncing to /auth/callback (which would render a bare no-session error).
      // Confirmation OFF: the SDK signed them in; route through /auth/callback
      // (→ claim invite / create org → /dashboard).
      if (needsEmailConfirmation) {
        setSentTo(values.email);
        return;
      }
      navigate("/auth/callback");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign up failed");
    }
  };

  if (sentTo) return <CheckYourEmailNotice email={sentTo} />;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
      <OAuthButtons disabled={isSubmitting} inviteCode={inviteCode?.trim() ?? ""} />
      <OrDivider />

      <FormField label="Full name" htmlFor="signup-name" error={errors.fullName?.message}>
        <Input autoComplete="name" autoFocus placeholder="Jamie Rivera" {...register("fullName")} />
      </FormField>

      <FormField label="Work email" htmlFor="signup-email" error={errors.email?.message}>
        <Input
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          {...register("email")}
        />
      </FormField>

      <FormField
        label="Password"
        htmlFor="signup-password"
        helper="At least 8 characters."
        error={errors.password?.message}
      >
        <Input
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          {...register("password")}
        />
      </FormField>

      <FormField
        label="Invite code"
        htmlFor="signup-invite"
        helper="Optional. Leave blank to start a new workspace; you can invite teammates after."
        error={errors.inviteCode?.message}
      >
        <Input
          autoComplete="off"
          placeholder="navigatr-acme-7k2p"
          {...register("inviteCode")}
        />
      </FormField>

      <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
        {isSubmitting ? "Creating account…" : "Create account"}
      </Button>

      <p className="text-center text-body-md text-text-muted">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-brand-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
