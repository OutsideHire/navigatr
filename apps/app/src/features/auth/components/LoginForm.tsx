import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button, FormField, Input } from "@/components/navigatr";
import { useAuth } from "@/stores/auth";
import { OAuthButtons, OrDivider } from "./OAuthButtons";

const schema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type Values = z.infer<typeof schema>;

export function LoginForm() {
  const signInWithEmail = useAuth((s) => s.signInWithEmail);
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: Values) => {
    try {
      await signInWithEmail(values.email, values.password);
      navigate("/dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
      <OAuthButtons disabled={isSubmitting} />
      <OrDivider />

      <FormField label="Work email" htmlFor="login-email" error={errors.email?.message}>
        <Input
          type="email"
          autoComplete="email"
          autoFocus
          placeholder="you@company.com"
          {...register("email")}
        />
      </FormField>

      <FormField label="Password" htmlFor="login-password" error={errors.password?.message}>
        <Input
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          {...register("password")}
        />
      </FormField>

      <div className="-mt-2 flex justify-end">
        <Link
          to="/forgot-password"
          className="text-caption text-brand-primary underline-offset-4 hover:underline"
        >
          Forgot password?
        </Link>
      </div>

      <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
        {isSubmitting ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-center text-body-md text-text-muted">
        New to navigatr?{" "}
        <Link to="/signup" className="font-medium text-brand-primary underline-offset-4 hover:underline">
          Sign up
        </Link>
      </p>
    </form>
  );
}
