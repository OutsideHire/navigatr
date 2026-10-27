/**
 * NewReferralLinkDialog (Partner Portal FR-PORT-27). An administrator gives one
 * rep a new personal referral form link. Two steps: a confirm that warns the
 * old link and any printed QR codes stop working, then the new address with a
 * copy button. The server enforces admin-only and same-org.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Copy, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/navigatr";
import { useRegenerateReferralLink } from "@/features/partners/hooks/useReferralLinks";
import { referralFormAddress } from "@/features/portal/lib/portalAddress";

export function NewReferralLinkDialog({
  open,
  onOpenChange,
  row,
  slug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: { agent_id: string; full_name: string | null; email: string };
  slug: string;
}) {
  const regenerate = useRegenerateReferralLink();
  const [url, setUrl] = React.useState<string | null>(null);
  const who = row.full_name ?? row.email;

  const getNew = async () => {
    try {
      const token = await regenerate.mutateAsync({ linkType: "user", userId: row.agent_id });
      setUrl(referralFormAddress(slug, token));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't get a new link. Try again.");
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy. Press and hold the link to copy it.");
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col gap-4 overflow-y-auto rounded-t-radius-lg bg-surface-default p-5 text-text-default shadow-card-hover sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-radius-lg"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-heading-sm text-text-default">New referral form link</Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-radius-sm text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          {url ? (
            <>
              <p className="text-body-sm text-text-muted">
                {who} has a new link. Send it to them. The old one no longer works.
              </p>
              <p className="break-all rounded-radius-sm bg-surface-sunken p-3 text-body-sm text-text-default">{url}</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="lg" leadingIcon={Copy} onClick={() => void copy()}>
                  Copy link
                </Button>
                <Button variant="tertiary" size="lg" onClick={() => onOpenChange(false)}>
                  Done
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-body-sm text-text-default">
                Get {who} a new referral form link? Their old link and any printed QR codes stop working right away.
              </p>
              <div className="flex gap-2">
                <Button variant="destructive" size="lg" loading={regenerate.isPending} onClick={() => void getNew()}>
                  Get new link
                </Button>
                <Button variant="tertiary" size="lg" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
