import { AuthSplitShell } from "../components/AuthShell";
import { LoginForm } from "../components/LoginForm";

export function LoginPage() {
  return (
    <AuthSplitShell
      title="Welcome back."
      subtitle="Sign in to your navigatr account."
      heroEyebrow="From sidewalk to signed"
      heroTitle="Every drop-in, every follow-up, every win — in one place."
      heroBody="The field-first CRM your reps will actually use. Built for payroll, merchant services, and treasury teams."
    >
      <LoginForm />
    </AuthSplitShell>
  );
}
