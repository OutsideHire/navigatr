import { AuthShell } from "../components/AuthShell";
import { ResetPasswordForm } from "../components/ResetPasswordForm";

export function ResetPasswordPage() {
  return (
    <AuthShell
      title="Set a new password"
      subtitle="Choose something you'll remember — and a password manager will love."
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
