import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button, FormField, Input } from "@/components/navigatr";
import { useAuth } from "@/stores/auth";

const schema = z.object({
  email: z.string().email("Enter a valid email address"),
});

type Values = z.infer<typeof schema>;

export function ForgotPasswordForm() {
  const resetPassword = useAuth((s) => s.resetPassword);
  const [sent, setSent] = useState(false);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (values: Values) => {
    try {
      await resetPassword(values.email);
      setSent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send reset link");
    }
  };

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-status-success-bg text-status-success">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-heading-md text-text-default">Check your email</h2>
          <p className="text-body-md text-text-muted">
            We sent a reset link to <span className="font-medium text-text-default">{getValues("email")}</span>.
            It expires in 1 hour.
          </p>
        </div>
        <Link
          to="/login"
          className="inline-flex items-center gap-1 text-body-md text-brand-primary underline-offset-4 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
      <FormField label="Work email" htmlFor="forgot-email" error={errors.email?.message}>
        <Input
          type="email"
          autoComplete="email"
          autoFocus
          placeholder="you@company.com"
          {...register("email")}
        />
      </FormField>

      <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
        {isSubmitting ? "Sending…" : "Send reset link"}
      </Button>

      <Link
        to="/login"
        className="inline-flex items-center justify-center gap-1 text-body-md text-text-muted underline-offset-4 hover:text-text-default hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to sign in
      </Link>
    </form>
  );
}
