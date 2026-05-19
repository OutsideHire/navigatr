import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge, Button, FormField, Input } from "@/components/navigatr";
import { useAuth } from "@/stores/auth";

const schema = z.object({
  fullName: z.string().trim().min(2, "Please enter your full name"),
  password: z.string().min(8, "At least 8 characters"),
});

type Values = z.infer<typeof schema>;

/**
 * Invitation acceptance flow — reads pre-assigned email + role from URL
 * search params, captures the invitee's name + password to finish signup.
 *
 * The real "claim invite" API call lands when the backend is wired
 * (Session 6+). Today we sign up via Supabase directly using the
 * pre-assigned email.
 */
export function InvitationAcceptanceForm() {
  const [params] = useSearchParams();
  const email = params.get("email") ?? "you@company.com";
  const role = params.get("role") ?? "sales_professional";
  const tenantName = params.get("tenant") ?? "your team";
  // Legacy /accept-invitation flow predates org-scoped invite codes. The
  // real backend now requires an invite_code; we forward it if the link
  // carries one, otherwise signup will fail server-side with a clear error.
  const inviteCode = params.get("code") ?? "";

  const signUp = useAuth((s) => s.signUp);
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: "", password: "" },
  });

  const onSubmit = async (values: Values) => {
    try {
      await signUp(email, values.password, values.fullName, inviteCode);
      navigate("/dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't accept invitation");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
      <div className="rounded-radius-md border border-border-subtle bg-surface-sunken p-4">
        <p className="text-caption text-text-subtle">Invited as</p>
        <p className="mt-1 text-body-strong text-text-default">{email}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge kind="stage-proposal">{role.replace(/_/g, " ")}</Badge>
          <span className="text-caption text-text-muted">at {tenantName}</span>
        </div>
      </div>

      <FormField label="Full name" htmlFor="invite-name" error={errors.fullName?.message}>
        <Input autoComplete="name" autoFocus placeholder="Jamie Rivera" {...register("fullName")} />
      </FormField>

      <FormField
        label="Password"
        htmlFor="invite-password"
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

      <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
        {isSubmitting ? "Accepting…" : "Accept invitation"}
      </Button>
    </form>
  );
}
