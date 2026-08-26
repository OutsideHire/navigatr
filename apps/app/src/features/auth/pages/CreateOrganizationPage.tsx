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

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { AuthSplitShell } from "../components/AuthShell";
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
});
type Values = z.infer<typeof schema>;

export function CreateOrganizationPage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const loading = useAuth((s) => s.loading);
  const profile = useProfile();
  const createOrg = useCreateOrganization();

  // Defensive routing: a user who somehow lands here while already
  // having a profile shouldn't see the create-org form (the RPC would
  // throw 'already_in_organization' anyway, but we shouldn't ask the
  // question we already know the answer to).
  useEffect(() => {
    if (!loading && !user) {
      navigate("/login", { replace: true });
      return;
    }
    if (profile.data) {
      navigate("/dashboard", { replace: true });
    }
  }, [loading, user, profile.data, navigate]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "" },
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
