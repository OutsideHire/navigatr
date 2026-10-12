/**
 * Share referral form (Partner Portal Phase 2B-1, FR-PORT-24, 26, 27). A rep
 * shares their personal public form link as a link, an on-screen QR code, a
 * downloadable QR image or through the phone's share sheet. Administrators
 * also get the company link for the website and printed material. "Get a new
 * link" retires the old link and QR code.
 *
 * Shown only while the ISO has the public form on (FR-PORT-28); the server
 * answers enabled: false otherwise.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Copy, Download, Loader2, QrCode, RefreshCw, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/navigatr";
import { useProfile } from "@/features/auth/useProfile";
import { referralFormAddress } from "@/features/portal/lib/portalAddress";
import {
  useMyReferralLink,
  useRegenerateReferralLink,
  useTenantReferralLink,
  type ReferralLink,
  type ReferralLinkType,
} from "../hooks/useReferralLinks";
import { referralQrDataUrl, referralQrFileName } from "../lib/referralQr";

export function ShareReferralFormButton() {
  const link = useMyReferralLink();
  const [open, setOpen] = React.useState(false);
  if (!link.data?.enabled) return null;
  return (
    <>
      <Button variant="secondary" size="lg" leadingIcon={QrCode} onClick={() => setOpen(true)}>
        Share referral form
      </Button>
      <ShareReferralFormSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

export function ShareReferralFormSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const mine = useMyReferralLink();
  const isAdmin = useProfile().data?.role_level === "administrator";
  const tenant = useTenantReferralLink(open && isAdmin);

  // The ISO has the public form off: there is nothing to share.
  if (mine.data && !mine.data.enabled) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col gap-5 overflow-y-auto rounded-t-radius-lg bg-surface-default p-5 text-text-default shadow-card-hover sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-radius-lg sm:max-h-[85vh]"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-heading-sm text-text-default">Share referral form</Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-radius-sm text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <p className="text-body-sm text-text-muted">
            Anyone with this link can send you a business. No sign-in needed.
          </p>
          <ReferralLinkPanel
            title="Your link"
            qrAlt="QR code for your link"
            description="Referrals sent through this link come to you."
            confirmText="Get a new link? Your old link and QR code stop working right away."
            linkType="user"
            link={mine.data}
          />
          {isAdmin && (
            <ReferralLinkPanel
              title="Company link"
              qrAlt="QR code for the company link"
              description="For your website and printed material. Referrals go to the administrator queue."
              confirmText="Get a new company link? The old link and QR code stop working right away."
              linkType="tenant"
              link={tenant.data}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ReferralLinkPanel({
  title,
  qrAlt,
  description,
  confirmText,
  linkType,
  link,
}: {
  title: string;
  qrAlt: string;
  description: string;
  confirmText: string;
  linkType: ReferralLinkType;
  link: ReferralLink | null | undefined;
}) {
  const regenerate = useRegenerateReferralLink();
  const [confirming, setConfirming] = React.useState(false);
  const [qr, setQr] = React.useState<string | null>(null);
  const [qrFailed, setQrFailed] = React.useState(false);
  const url = link?.token ? referralFormAddress(link.slug, link.token) : null;

  React.useEffect(() => {
    setQr(null);
    setQrFailed(false);
    if (!url) return;
    let live = true;
    referralQrDataUrl(url).then(
      (dataUrl) => {
        if (live) setQr(dataUrl);
      },
      () => {
        if (live) setQrFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [url]);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy. Press and hold the link to copy it.");
    }
  };

  const share = async () => {
    if (!url) return;
    if (typeof navigator.share !== "function") {
      await copy();
      return;
    }
    try {
      await navigator.share({ title: "Referral form", url });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) await copy();
    }
  };

  const getNew = async () => {
    try {
      await regenerate.mutateAsync({ linkType });
      toast.success("New link ready. The old one no longer works.");
      setConfirming(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't get a new link. Try again.");
    }
  };

  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-body-strong text-text-default">{title}</h3>
        <p className="text-body-sm text-text-muted">{description}</p>
      </div>
      {link === undefined && <Loader2 className="h-5 w-5 animate-spin text-text-subtle" aria-label="Loading" />}
      {url && (
        <>
          <p className="break-all rounded-radius-sm bg-surface-sunken p-3 text-body-sm text-text-default">{url}</p>
          {qr ? (
            <img src={qr} alt={qrAlt} className="mx-auto h-48 w-48 rounded-radius-md bg-white p-2" />
          ) : qrFailed ? (
            <p className="text-body-sm text-text-muted">Couldn't make the QR code. The link above still works.</p>
          ) : (
            <div className="mx-auto h-48 w-48 rounded-radius-md bg-surface-sunken" aria-hidden />
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" leadingIcon={Copy} onClick={() => void copy()}>
              Copy link
            </Button>
            <Button variant="secondary" size="lg" leadingIcon={Share2} onClick={() => void share()}>
              Share
            </Button>
          </div>
          {qr && (
            <a
              href={qr}
              download={referralQrFileName(linkType)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-radius-md border border-border-default text-body-sm text-text-default hover:bg-surface-sunken"
            >
              <Download className="h-4 w-4" aria-hidden />
              Download QR
            </a>
          )}
          {confirming ? (
            <div className="flex flex-col gap-2">
              <p className="text-body-sm text-text-default">{confirmText}</p>
              <div className="flex gap-2">
                <Button variant="destructive" size="lg" loading={regenerate.isPending} onClick={() => void getNew()}>
                  Get new link
                </Button>
                <Button variant="tertiary" size="lg" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="tertiary" size="lg" leadingIcon={RefreshCw} onClick={() => setConfirming(true)}>
              Get a new link
            </Button>
          )}
        </>
      )}
    </section>
  );
}
