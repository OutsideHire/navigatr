import { AuthShell } from "../components/AuthShell";
import { SignUpForm } from "../components/SignUpForm";

export function SignUpPage() {
  return (
    <AuthShell title="Create your account" subtitle="Start your free trial in under a minute.">
      <SignUpForm />
    </AuthShell>
  );
}
