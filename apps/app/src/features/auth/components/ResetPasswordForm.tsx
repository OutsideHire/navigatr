import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button, FormField, Input } from "@/components/navigatr";
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

export function ResetPasswordForm() {
  const updatePassword = useAuth((s) => s.updatePassword);
  const navigate = useNavigate();

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
      toast.error(err instanceof Error ? err.message : "Couldn't update password");
    }
  };

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
