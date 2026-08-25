/**
 * CheckYourEmailNotice — shown after signup when the project requires email
 * confirmation (Supabase returns no session until the link is clicked). Without
 * this, both the self-serve signup form and the invite-acceptance form
 * navigated straight to /auth/callback, which has no session yet and rendered a
 * bare "Sign-in did not complete" error at the moment of signup.
 *
 * The confirmation link works from any tab or device (the invite is carried in
 * user_metadata; see resolveInviteCode), so the copy says so.
 *
 * A Resend affordance makes a lost / spam-filtered first email recoverable
 * rather than a dead-end. It cools down for a short window after each send so a
 * user cannot hammer Supabase's rate limit.
 */
import * as React from "react";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/navigatr";
import { useAuth } from "@/stores/auth";

const RESEND_COOLDOWN_SECONDS = 30;

export function CheckYourEmailNotice({ email }: { email: string }) {
  const resendSignupEmail = useAuth((s) => s.resendSignupEmail);
  const [cooldown, setCooldown] = React.useState(0);
  const [status, setStatus] = React.useState<"idle" | "sending" | "sent" | "error">("idle");

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const onResend = () => {
    setStatus("sending");
    resendSignupEmail(email)
      .then(() => {
        setStatus("sent");
        setCooldown(RESEND_COOLDOWN_SECONDS);
      })
      .catch(() => setStatus("error"));
  };

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

      <div className="flex flex-col items-center gap-1">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onResend}
          loading={status === "sending"}
          disabled={cooldown > 0 || status === "sending"}
        >
          {cooldown > 0 ? `Resend email (${cooldown}s)` : "Resend email"}
        </Button>
        {status === "sent" && (
          <p className="text-caption text-status-success" role="status">
            Sent. Check your inbox and spam folder.
          </p>
        )}
        {status === "error" && (
          <p className="text-caption text-status-danger" role="status">
            Couldn't resend just now. Try again in a moment.
          </p>
        )}
      </div>
    </div>
  );
}
