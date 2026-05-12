import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button, FormField, Input } from "@/components/navigatr";
import { useAuth } from "@/stores/auth";
import { OAuthButtons, OrDivider } from "./OAuthButtons";

const schema = z.object({
  fullName: z.string().trim().min(2, "Please enter your full name"),
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "At least 8 characters"),
});

type Values = z.infer<typeof schema>;

export function SignUpForm() {
  const signUp = useAuth((s) => s.signUp);
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: "", email: "", password: "" },
  });

  const onSubmit = async (values: Values) => {
    try {
      await signUp(values.email, values.password, values.fullName);
      navigate("/select-profession");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign up failed");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
      <OAuthButtons disabled={isSubmitting} />
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
