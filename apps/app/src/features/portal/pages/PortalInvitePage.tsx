/**
 * Accept a portal invite (spec 5.3, FR-PORT-18): read navigatr's Referral Portal
 * Terms and the ISO's partner terms, agree to both with one checkbox, continue.
 * Accepting records the time, IP and both terms versions server-side
 * and signs the partner in. A partner who does not agree just leaves; nothing
 * changes.
 */
import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button, Card, Checkbox } from "@/components/navigatr";
import { PortalApiError, isPortalTransientError, portalApi, type PortalBrand } from "../lib/portalApi";
import { PortalRetry, portalReachMessage } from "../components/PortalRetry";
import { PortalTermsText } from "../components/PortalTermsText";
import { portalTermsAgreeLabel } from "../lib/portalTermsLabel";
import { writePortalSession } from "../lib/portalSession";
import { clearInviteToken, readInviteToken, writeInviteToken } from "../lib/portalInviteToken";
import { portalPath } from "../lib/portalAddress";

function InviteUnavailable({ slug, orgName }: { slug: string; orgName: string }) {
  const navigate = useNavigate();
  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <h1 className="text-heading-lg text-text-default">This invite link has expired or was already used</h1>
      <p className="text-body-md text-text-muted">
        Ask your contact at {orgName} to send a new one. If you already accepted, sign in instead.
      </p>
      <Button variant="secondary" size="md" onClick={() => navigate(portalPath(slug))}>
        Go to sign in
      </Button>
    </Card>
  );
}

export function PortalInvitePage({ slug, brand }: { slug: string; brand: PortalBrand }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Copy the token out of the URL once, then drop it from the address bar and
  // history so it cannot linger, be shared, or reach telemetry. It is also kept
  // in this tab's sessionStorage for this portal only, so reloading the terms
  // screen does not lose it; accepting clears it.
  const [token] = React.useState(() => {
    const fromUrl = (params.get("token") ?? "").trim();
    if (fromUrl) {
      writeInviteToken(slug, fromUrl);
      return fromUrl;
    }
    return readInviteToken(slug) ?? "";
  });
  const urlHasToken = params.has("token");
  React.useEffect(() => {
    if (urlHasToken) navigate(portalPath(slug, `/invite`), { replace: true });
  }, [urlHasToken, slug, navigate]);
  const [agreed, setAgreed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [canRetryAccept, setCanRetryAccept] = React.useState(false);

  const invite = useQuery({
    queryKey: ["portal", "invite", slug, token],
    queryFn: () => portalApi.peekInvite(slug, token),
    enabled: token.length > 0,
    retry: false,
  });

  // A stored invite the server says is dead must not be replayed on reload.
  const inviteInvalid =
    (invite.isError && !isPortalTransientError(invite.error)) || (invite.isSuccess && !invite.data);
  React.useEffect(() => {
    if (inviteInvalid) clearInviteToken(slug);
  }, [inviteInvalid, slug]);

  if (!token) return <InviteUnavailable slug={slug} orgName={brand.orgName} />;
  if (invite.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
      </div>
    );
  }
  if (invite.isError && isPortalTransientError(invite.error)) {
    return <PortalRetry name={brand.orgName} onRetry={() => void invite.refetch()} busy={invite.isFetching} />;
  }
  if (invite.isError || !invite.data) return <InviteUnavailable slug={slug} orgName={brand.orgName} />;

  const data = invite.data;

  const accept = async () => {
    setBusy(true);
    setNotice(null);
    setCanRetryAccept(false);
    try {
      const session = await portalApi.acceptInvite(slug, token, data.termsVersion, data.navigatrTermsVersion);
      writePortalSession(slug, session.sessionToken);
      clearInviteToken(slug);
      navigate(portalPath(slug, `/home`), { replace: true });
    } catch (err) {
      if (err instanceof PortalApiError && err.code === "terms_changed") {
        setAgreed(false);
        setNotice("The terms were just updated. Please read them again.");
        await invite.refetch();
      } else if (isPortalTransientError(err)) {
        setNotice(portalReachMessage(brand.orgName));
        setCanRetryAccept(true);
      } else {
        setNotice("This invite can't be used anymore. Ask your contact for a new one.");
      }
      setBusy(false);
    }
  };

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-heading-lg text-text-default">Welcome, {data.partnerName}</h1>
        <p className="text-body-md text-text-muted">
          {data.orgName} invited you to their referral portal. Read and accept the terms to continue.
        </p>
      </div>

      <PortalTermsText navigatrText={data.navigatrTermsText} isoText={data.termsText} />

      {notice && (
        <p role="alert" className="text-body-sm text-status-danger">
          {notice}
        </p>
      )}
      {canRetryAccept && (
        <Button variant="secondary" size="md" disabled={busy} onClick={() => void accept()}>
          Try again
        </Button>
      )}

      <Checkbox
        id="portal-terms-agree"
        checked={agreed}
        onCheckedChange={setAgreed}
        label={portalTermsAgreeLabel(data.orgName, data.termsText)}
      />

      <Button
        variant="primary"
        size="lg"
        fullWidth
        loading={busy}
        disabled={!agreed || busy}
        onClick={() => void accept()}
      >
        Accept and continue
      </Button>
      <p className="text-caption text-text-subtle">If you don&apos;t agree, just close this page.</p>
    </Card>
  );
}
