/**
 * /welcome — the ISO-admin activation invite step (onboarding A1).
 *
 * Reached right after create_organization instead of dropping the admin on an
 * empty dashboard. The whole point of A1 is "team invited", so this puts the
 * two fastest invite paths front and center: a few emails, or a shareable link.
 * Reuses the existing invite machinery (admin_bulk_invite + send_invite_email);
 * the link mirrors Settings > Team (`/signup?code=<inviteCode>`).
 *
 * Only for users who can invite; anyone else is bounced to the dashboard.
 */
import * as React from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { AuthSplitShell } from "../components/AuthShell";
import { Button, FormField, Input } from "@/components/navigatr";
import { useProfile } from "../useProfile";
import { useOrganization } from "../useOrganization";
import { profileCan, ROLE_LEVEL_OPTIONS, type RoleLevel } from "@/features/auth/capabilities";
import { useAdminBulkInvite } from "@/features/admin/hooks/useAdminBulkInvite";
import { useSendInviteEmails } from "@/features/admin/hooks/useSendInviteEmails";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function WelcomeInvitePage() {
  const navigate = useNavigate();
  const profile = useProfile();
  const org = useOrganization();
  const bulkInvite = useAdminBulkInvite();
  const sendEmails = useSendInviteEmails();

  const [emails, setEmails] = React.useState<string[]>(["", "", ""]);
  const [roleLevel, setRoleLevel] = React.useState<RoleLevel>("sales_professional");
  const [submitting, setSubmitting] = React.useState(false);

  // Hold while the profile is loading OR refetching. create_organization
  // invalidates ["profile"] right before routing here, so on the first render
  // the cached value is a stale null; reading it now would wrongly bounce a
  // just-created admin past the invite step. Wait for the fresh row, like
  // ProtectedRoute does.
  if (profile.isLoading || profile.isFetching) return null;
  // Inviting is an administrator/CSO capability; everyone else skips this step.
  if (!profileCan(profile.data, "inviteUsers")) return <Navigate to="/dashboard" replace />;

  const inviteLink = org.data?.inviteCode
    ? `${window.location.origin}/signup?code=${encodeURIComponent(org.data.inviteCode)}`
    : "";

  const goDashboard = () => navigate("/dashboard", { replace: true });

  const onSend = async () => {
    const rows = emails
      .map((e) => e.trim())
      .filter((e) => EMAIL_RE.test(e))
      .map((email) => ({ email, full_name: null, role_level: roleLevel }));
    if (rows.length === 0) {
      toast.error("Add at least one valid email, or share your link instead.");
      return;
    }
    setSubmitting(true);
    try {
      const results = await bulkInvite.mutateAsync(rows);
      const okIds = results.filter((r) => r.ok && r.id).map((r) => r.id as string);
      if (okIds.length > 0) {
        // A failed email send must not block the admin from moving on; the
        // invite rows already exist and can be re-sent from the Team page.
        try {
          await sendEmails.mutateAsync(okIds);
        } catch {
          /* logged server-side; ignore here */
        }
        toast.success(`Invited ${okIds.length} teammate${okIds.length === 1 ? "" : "s"}.`);
      }
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        toast.error(`${failed.length} couldn't be invited (already invited or invalid).`);
      }
      goDashboard();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send invites.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = () => {
    void navigator.clipboard?.writeText(inviteLink);
    toast.success("Invite link copied.");
  };

  return (
    <AuthSplitShell
      title="Your workspace is ready."
      subtitle="Now bring your team in. Invite a few reps by email, or share your link."
      heroEyebrow="You're all set"
      heroTitle="Your team, on the same page."
      heroBody="Reps get a branded invite and land straight in their pipeline. You can always invite more later from the Team page."
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <FormField label="Invite as" htmlFor="invite-role">
            <select
              id="invite-role"
              value={roleLevel}
              onChange={(e) => setRoleLevel(e.target.value as RoleLevel)}
              className="h-10 w-full rounded-radius-md border border-border-default bg-surface-raised px-3 text-body-md text-text-default"
            >
              {ROLE_LEVEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </FormField>

          {emails.map((val, i) => (
            <Input
              key={i}
              type="email"
              aria-label={`Teammate email ${i + 1}`}
              placeholder="rep@company.com"
              value={val}
              onChange={(e) =>
                setEmails((arr) => arr.map((v, idx) => (idx === i ? e.target.value : v)))
              }
            />
          ))}

          <button
            type="button"
            onClick={() => setEmails((a) => [...a, ""])}
            className="self-start text-caption font-medium text-brand-primary underline-offset-4 hover:underline"
          >
            + Add another
          </button>

          <Button type="button" size="lg" fullWidth loading={submitting} onClick={() => void onSend()}>
            {submitting ? "Sending invites…" : "Send invites"}
          </Button>

          <button
            type="button"
            onClick={() => navigate("/admin/agents/import")}
            className="self-center text-caption text-text-muted underline-offset-4 hover:underline"
          >
            Import a CSV instead
          </button>
        </div>

        {inviteLink && (
          <div className="flex flex-col gap-2 border-t border-border-subtle pt-4">
            <span className="text-body-strong text-text-default">Or share a link</span>
            <div className="flex gap-2">
              <Input readOnly aria-label="Invite link" value={inviteLink} />
              <Button type="button" variant="secondary" onClick={copyLink}>Copy</Button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={goDashboard}
          className="self-center text-caption text-text-muted underline-offset-4 hover:underline"
        >
          Skip for now
        </button>
      </div>
    </AuthSplitShell>
  );
}

export default WelcomeInvitePage;
