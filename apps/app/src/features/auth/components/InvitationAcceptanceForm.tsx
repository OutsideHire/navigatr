import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/navigatr";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/stores/auth";

const schema = z.object({
  fullName: z.string().trim().min(2, "Please enter your full name"),
  password: z.string().min(8, "At least 8 characters"),
});

type Values = z.infer<typeof schema>;

/**
 * Invitation acceptance flow.
 *
 * In v1 (per the kickoff brief) team-admin invitations are created
 * server-side as Supabase users with a one-time link. This component
 * reads the pre-assigned email + role from URL search params and lets
 * the invitee finish onboarding by setting their name + password.
 *
 * The real API call to claim the invite lands when the backend is wired
 * (Session 6+) — today we sign up via Supabase directly using the
 * pre-assigned email and forward the role + tenant in `user_metadata`.
 */
export function InvitationAcceptanceForm() {
  const [params] = useSearchParams();
  const email = params.get("email") ?? "you@company.com";
  const role = params.get("role") ?? "sales_professional";
  const tenantName = params.get("tenant") ?? "your team";

  const signUp = useAuth((s) => s.signUp);
  const navigate = useNavigate();
  const [show, setShow] = useState(false);

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
      await signUp(email, values.password, values.fullName);
      // Profession is inherited from the inviting tenant — skip the picker.
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
          <span className="rounded-radius-sm bg-accent-violet-20 px-2 py-0.5 text-caption font-medium text-accent-violet">
            {role.replace(/_/g, " ")}
          </span>
          <span className="text-caption text-text-muted">at {tenantName}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-name">Full name</Label>
        <Input
          id="invite-name"
          autoComplete="name"
          autoFocus
          aria-invalid={!!errors.fullName}
          {...register("fullName")}
          placeholder="Jamie Rivera"
        />
        {errors.fullName && (
          <p className="text-caption text-status-danger">{errors.fullName.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-password">Password</Label>
        <div className="relative">
          <Input
            id="invite-password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...register("password")}
            placeholder="At least 8 characters"
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-text-subtle hover:text-text-default"
            aria-label={show ? "Hide password" : "Show password"}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.password ? (
          <p className="text-caption text-status-danger">{errors.password.message}</p>
        ) : (
          <p className="text-caption text-text-subtle">At least 8 characters.</p>
        )}
      </div>

      <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
        {isSubmitting ? "Accepting…" : "Accept invitation"}
      </Button>
    </form>
  );
}
