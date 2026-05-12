import { AuthShell } from "../components/AuthShell";
import { ForgotPasswordForm } from "../components/ForgotPasswordForm";

export function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter your work email and we'll send a reset link."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
