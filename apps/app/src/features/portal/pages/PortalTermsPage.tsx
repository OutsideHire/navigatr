/**
 * Accept changed partner terms (FR-PORT-18, Q13). When the ISO edits its terms,
 * a signed-in partner sees this in place of the portal until they agree to the
 * new version; the signed-in layout shows it whenever me() reports the terms are
 * not current. Accepting records the time, IP and version server-side. A 409
 * means the ISO changed the terms again while the partner was reading, so the
 * new text loads and they agree again. A partner who does not agree can sign out.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button, Card, Checkbox } from "@/components/navigatr";
import {
  PortalApiError,
  isPortalTransientError,
  isPortalUnauthorized,
  portalApi,
  portalDataKey,
  type PortalBrand,
} from "../lib/portalApi";
import { PortalRetry, portalReachMessage } from "../components/PortalRetry";
import { PortalTermsText } from "../components/PortalTermsText";

export function PortalTermsPage({
  slug,
  token,
  brand,
  onAccepted,
  onExpired,
}: {
  slug: string;
  token: string;
  brand: PortalBrand;
  onAccepted: () => void;
  onExpired: () => void;
}) {
  const [agreed, setAgreed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [canRetryAccept, setCanRetryAccept] = React.useState(false);

  const terms = useQuery({
    queryKey: portalDataKey(slug, token, "terms"),
    queryFn: () => portalApi.getTerms(slug, token),
    retry: false,
    // Always ask the server on mount: terms can change twice in one session, and
    // a cached "current" answer from the earlier visit must not count as current.
    staleTime: 0,
    gcTime: 0,
  });

  const expired = (terms.isSuccess && !terms.data) || isPortalUnauthorized(terms.error);
  // Already current, for example accepted on another device: nothing to ask.
  const alreadyCurrent = terms.isSuccess && !terms.isFetching && terms.data?.termsCurrent === true;
  React.useEffect(() => {
    if (expired) onExpired();
  }, [expired, onExpired]);
  React.useEffect(() => {
    if (alreadyCurrent) onAccepted();
  }, [alreadyCurrent, onAccepted]);

  if (terms.isPending || expired || alreadyCurrent) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
      </div>
    );
  }
  if (terms.isError || !terms.data) {
    return <PortalRetry name={brand.orgName} onRetry={() => void terms.refetch()} busy={terms.isFetching} />;
  }

  const data = terms.data;

  const accept = async () => {
    setBusy(true);
    setNotice(null);
    setCanRetryAccept(false);
    try {
      await portalApi.acceptTerms(slug, token, data.termsVersion);
      onAccepted();
    } catch (err) {
      if (isPortalUnauthorized(err)) {
        onExpired();
        return;
      }
      if (err instanceof PortalApiError && err.code === "terms_changed") {
        setAgreed(false);
        setNotice("The terms were just updated. Please read them again.");
        await terms.refetch();
      } else {
        setNotice(portalReachMessage(brand.orgName));
        setCanRetryAccept(isPortalTransientError(err));
      }
    } finally {
      // The follow-up me() re-check can fail and leave this page showing.
      setBusy(false);
    }
  };

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-heading-lg text-text-default">{brand.orgName} updated its partner terms</h1>
        <p className="text-body-md text-text-muted">Read and agree to the new terms to keep using the portal.</p>
      </div>

      <PortalTermsText text={data.termsText} />

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
        label="I agree to these terms"
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
      <p className="text-caption text-text-subtle">If you don&apos;t agree, sign out.</p>
    </Card>
  );
}
