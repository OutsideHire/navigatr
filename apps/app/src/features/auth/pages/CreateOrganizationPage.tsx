/**
 * /create-organization — name-your-workspace step for self-serve signup.
 *
 * Reached after a user signs up (email-password or OAuth) without an
 * invite code. AuthCallbackPage and ProtectedRoute route here when the
 * authenticated user has no profile row yet.
 *
 * On submit: calls create_organization(), which atomically creates the
 * org + a manager profile for the caller, then routes to /welcome (the
 * invite-your-team activation step) which surfaces the shareable invite
 * code/link. The code also lives permanently in Settings > Team.
 */

import { useEffect, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { AuthSplitShell } from "../components/AuthShell";
import { TermsConsent } from "../components/TermsConsent";
import { Button, FormField, Input } from "@/components/navigatr";
import { useCreateOrganization } from "../useCreateOrganization";
import { useAuth } from "@/stores/auth";
import { useProfile } from "../useProfile";

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Pick a name with at least 2 characters")
    .max(80, "Pick a name shorter than 80 characters"),
  // Clickwrap: this is the account-completion step for self-serve signup,
  // including a brand-new user who authenticated via Google (from /signup OR
  // /login), so consent is captured here for every self-serve path.
  agreedToTerms: z
    .boolean()
    .refine((v) => v === true, { message: "Please agree to the Terms and Privacy Policy" }),
});
type Values = z.infer<typeof schema>;

export function CreateOrganizationPage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const loading = useAuth((s) => s.loading);
  const profile = useProfile();
  const createOrg = useCreateOrganization();

  // Defensive routing: a user who ARRIVES here already having a profile is
  // already in an org and shouldn't see the create form -> send them to the
  // dashboard. Only the AT-MOUNT state counts: after a successful create the
  // profile appears here too, but onSubmit routes that user to /welcome (the
  // invite step), and this effect must not race it to /dashboard.
  const hadProfileAtMount = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (!loading && !user) {
      navigate("/login", { replace: true });
      return;
    }
    if (profile.isLoading) return; // wait until the profile query settles
    if (hadProfileAtMount.current === undefined) {
      hadProfileAtMount.current = Boolean(profile.data);
    }
    if (hadProfileAtMount.current) {
      navigate("/dashboard", { replace: true });
    }
  }, [loading, user, profile.isLoading, profile.data, navigate]);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", agreedToTerms: false },
  });

  const onSubmit = async (values: Values) => {
    try {
      await createOrg.mutateAsync(values.name);
      toast.success("Workspace created.");
      // Straight into the activation step (invite your team), which surfaces the
      // shareable invite code/link, instead of dropping onto an empty dashboard.
      navigate("/welcome", { replace: true });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not create workspace",
      );
    }
  };

  // Hold the spinner if we don't know whether the user has a profile yet.
  if (loading || profile.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-canvas">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" />
      </div>
    );
  }

  return (
    <AuthSplitShell
      title="Name your workspace."
      subtitle="One workspace per company. You'll be the manager — teammates join via your invite link."
      heroEyebrow="Welcome to navigatr"
      heroTitle="Two minutes to your pipeline."
      heroBody="Name your workspace, then start logging activities. You can invite the rest of the team whenever you're ready."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        <FormField
          label="Workspace name"
          htmlFor="org-name"
          helper="Usually your company's name. Shows up in the top bar."
          error={errors.name?.message}
        >
          <Input
            id="org-name"
            autoFocus
            autoComplete="organization"
            placeholder="e.g., Acme Payments"
            {...register("name")}
          />
        </FormField>

        <Controller
          name="agreedToTerms"
          control={control}
          render={({ field, fieldState }) => (
            <TermsConsent
              ref={field.ref}
              checked={field.value}
              onCheckedChange={field.onChange}
              error={fieldState.error?.message}
              disabled={isSubmitting}
            />
          )}
        />

        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          {isSubmitting ? "Creating workspace…" : "Create workspace"}
        </Button>

        <p className="text-center text-caption text-text-muted">
          Have an invite code instead?{" "}
          <button
            type="button"
            onClick={() => navigate("/auth/callback")}
            className="font-medium text-brand-primary underline-offset-4 hover:underline"
          >
            Use it here
          </button>
          .
        </p>
      </form>
    </AuthSplitShell>
  );
}

export default CreateOrganizationPage;
