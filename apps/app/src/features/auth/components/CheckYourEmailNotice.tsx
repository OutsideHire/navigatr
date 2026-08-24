/**
 * CheckYourEmailNotice — shown after signup when the project requires email
 * confirmation (Supabase returns no session until the link is clicked). Without
 * this, both the self-serve signup form and the invite-acceptance form
 * navigated straight to /auth/callback, which has no session yet and rendered a
 * bare "Sign-in did not complete" error at the moment of signup.
 *
 * The confirmation link works from any tab or device (the invite is carried in
 * user_metadata; see resolveInviteCode), so the copy says so.
 */
import { MailCheck } from "lucide-react";

export function CheckYourEmailNotice({ email }: { email: string }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-status-success-bg text-status-success">
        <MailCheck className="h-6 w-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-heading-md text-text-default">Check your email</h2>
        <p className="text-body-md text-text-muted">
          We sent a confirmation link to{" "}
          <span className="font-medium text-text-default">{email}</span>. Open it to finish
          setting up your account. You can open it on any device.
        </p>
      </div>
    </div>
  );
}
