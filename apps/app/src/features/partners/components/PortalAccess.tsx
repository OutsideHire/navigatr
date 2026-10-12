/**
 * Partner portal controls on the partner record.
 *
 *   PortalInviteButton : hero-row button. "Invite to portal" (or "Resend invite"
 *                        while pending). Shown only when the org portal is on and
 *                        the partner has an email.
 *   PortalAccessLine   : contact-card line "Portal: <status>" with a compact
 *                        Manage disclosure (suspend, revoke, restore, copy address).
 *
 * The server re-checks every action (can_see_partner); these only hide what the
 * viewer cannot meaningfully do.
 */
import * as React from "react";
import { toast } from "sonner";
import { Copy, KeyRound, Send } from "lucide-react";
import { Button } from "@/components/navigatr";
import { portalAddress } from "@/features/portal/lib/portalAddress";
import { PORTAL_STATUS_LABEL, portalAccessErrorMessage, type PortalAccessChange } from "../lib/portalAccess";
import { useInviteToPortal, usePartnerPortalUser, usePortalStatus, useSetPortalAccess } from "../hooks/usePortalAccess";

export function PortalInviteButton({ partnerId, email }: { partnerId: string; email: string | null | undefined }) {
  const status = usePortalStatus();
  const portalUser = usePartnerPortalUser(partnerId);
  const invite = useInviteToPortal();
  const address = (email ?? "").trim();

  if (!status.data?.enabled || !address || portalUser.isPending || portalUser.isError) return null;
  const current = portalUser.data?.status ?? null;
  if (current !== null && current !== "invited") return null;

  const onClick = async () => {
    try {
      const result = await invite.mutateAsync(partnerId);
      if (result.emailed) toast.success(`Invite sent to ${address}`);
      else toast.success("Invite created, but no email was sent (test environment).");
    } catch (err) {
      toast.error(portalAccessErrorMessage(err));
    }
  };

  return (
    <Button variant="secondary" size="md" leadingIcon={Send} loading={invite.isPending} onClick={() => void onClick()}>
      {current === "invited" ? "Resend invite" : "Invite to portal"}
    </Button>
  );
}

const CHANGE_COPY: Record<PortalAccessChange, { label: string; done: string }> = {
  suspended: { label: "Suspend access", done: "Portal access suspended" },
  revoked: { label: "Revoke access", done: "Portal access revoked" },
  invited: { label: "Restore access", done: "Access restored. Send a new invite so they can sign in." },
};

export function PortalAccessLine({ partnerId, partnerName }: { partnerId: string; partnerName?: string }) {
  const status = usePortalStatus();
  const portalUser = usePartnerPortalUser(partnerId);
  const setAccess = useSetPortalAccess();
  const [open, setOpen] = React.useState(false);
  const [confirming, setConfirming] = React.useState<"suspended" | "revoked" | null>(null);

  if (!status.data?.enabled) return null;
  if (portalUser.isError) {
    return (
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-body-md text-text-default">Couldn't load portal status.</span>
        <Button variant="tertiary" size="sm" onClick={() => void portalUser.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  const who = partnerName?.trim() || "this partner";
  const slug = status.data.slug;
  const current = portalUser.data?.status ?? null;
  const changes: PortalAccessChange[] =
    current === "active" || current === "invited"
      ? ["suspended", "revoked"]
      : current === "suspended"
        ? ["invited", "revoked"]
        : current === "revoked"
          ? ["invited"]
          : [];

  const change = async (next: PortalAccessChange) => {
    try {
      await setAccess.mutateAsync({ partnerId, status: next });
      toast.success(CHANGE_COPY[next].done);
      setOpen(false);
      setConfirming(null);
    } catch (err) {
      toast.error(portalAccessErrorMessage(err));
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(portalAddress(slug));
      toast.success("Portal address copied");
    } catch {
      toast.error("Couldn't copy. Long-press the address to copy it.");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-accent-violet-20 text-accent-violet">
          <KeyRound className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-body-md text-text-default">
          Portal: {current ? PORTAL_STATUS_LABEL[current] : "Not invited"}
        </span>
        <Button
          variant="tertiary"
          size="sm"
          aria-expanded={open}
          onClick={() => {
            // Closing (or reopening) always starts from the action list.
            setConfirming(null);
            setOpen((v) => !v);
          }}
        >
          Manage
        </Button>
      </div>
      {open && confirming && (
        <div className="flex flex-col gap-2 pl-12">
          <p className="text-body-sm text-text-default">
            {confirming === "revoked"
              ? `Revoke ${who}'s portal access? They are signed out right away.`
              : `Suspend ${who}'s portal access? They are signed out until you restore it.`}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" loading={setAccess.isPending} onClick={() => void change(confirming)}>
              Confirm
            </Button>
            <Button variant="tertiary" size="sm" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {open && !confirming && (
        <div className="flex flex-wrap items-center gap-2 pl-12">
          {changes.map((next) => (
            <Button
              key={next}
              variant="secondary"
              size="sm"
              loading={setAccess.isPending}
              onClick={() => (next === "invited" ? void change(next) : setConfirming(next))}
            >
              {CHANGE_COPY[next].label}
            </Button>
          ))}
          <Button variant="secondary" size="sm" leadingIcon={Copy} onClick={() => void copy()}>
            Copy portal address
          </Button>
          {changes.includes("invited") && (
            <p className="w-full text-body-sm text-text-muted">
              Restoring lets you send a new invite. Their old sign-ins stay off.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
