import { AuthSplitShell } from "../components/AuthShell";
import { InvitationAcceptanceForm } from "../components/InvitationAcceptanceForm";

export function InvitationAcceptancePage() {
  return (
    <AuthSplitShell
      title="You're invited."
      subtitle="Finish setting up your account to join the team."
      heroEyebrow="Your team is waiting"
      heroTitle="Get started in under a minute."
      heroBody="Your tenant, profession, and role are already set. Just pick a password and you're in."
    >
      <InvitationAcceptanceForm />
    </AuthSplitShell>
  );
}
