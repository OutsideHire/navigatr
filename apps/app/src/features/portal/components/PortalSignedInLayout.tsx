/**
 * PortalSignedInLayout: every signed-in portal page sits inside this layout
 * route. It checks the session once (me), shows who is signed in with a Sign out
 * button, and hands the pages their context. Any page that gets a 401 calls
 * expire(), which forgets the session on this device and returns to sign-in.
 * An expiry keeps an unsent referral draft so nothing typed is lost; an
 * explicit Sign out also clears it, since the device may be shared.
 *
 * FR-PORT-18: when me reports the ISO's terms changed since the partner last
 * accepted them, the terms page stands in for every signed-in page until they
 * agree (Sign out stays available). A 403 terms_required from any request
 * mid-session re-checks me, so the terms page comes up at the next action.
 */
import * as React from "react";
import { Link, Navigate, Outlet, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut, User } from "lucide-react";
import { Button } from "@/components/navigatr";
import { PortalRetry } from "./PortalRetry";
import { PortalTermsPage } from "../pages/PortalTermsPage";
import { onPortalTermsRequired, portalApi, type PortalBrand } from "../lib/portalApi";
import { clearPortalDraft } from "../lib/portalDraft";
import { clearPortalSession, readPortalSession } from "../lib/portalSession";
import type { PortalSignedInContext } from "../lib/portalSignedIn";
import { portalPath } from "../lib/portalAddress";

export function PortalSignedInLayout({ slug, brand }: { slug: string; brand: PortalBrand }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [token] = React.useState(() => readPortalSession(slug));
  const [signingOut, setSigningOut] = React.useState(false);

  const me = useQuery({
    queryKey: ["portal", "me", slug, token],
    queryFn: () => portalApi.me(slug, token ?? ""),
    enabled: Boolean(token),
    retry: false,
  });

  const forget = React.useCallback(() => {
    clearPortalSession(slug);
    // Nothing cached about this partner may outlive the session on this device.
    queryClient.removeQueries({ queryKey: ["portal", "me", slug] });
    queryClient.removeQueries({ queryKey: ["portal", "data", slug] });
    navigate(portalPath(slug), { replace: true });
  }, [slug, queryClient, navigate]);

  const expired = me.isSuccess && me.data === null;
  React.useEffect(() => {
    if (expired) forget();
  }, [expired, forget]);

  const recheck = me.refetch;
  React.useEffect(() => onPortalTermsRequired(() => void recheck()), [recheck]);

  const termsAccepted = React.useCallback(() => {
    // Pages that hit terms_required load afresh when they mount again.
    void queryClient.invalidateQueries({ queryKey: ["portal", "data", slug], refetchType: "none" });
    void recheck();
  }, [queryClient, slug, recheck]);

  if (!token) return <Navigate to={portalPath(slug)} replace />;
  const sessionToken: string = token;

  if (me.isPending || expired) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
      </div>
    );
  }

  if (me.isError || !me.data) {
    return <PortalRetry name={brand.orgName} onRetry={() => void me.refetch()} busy={me.isFetching} />;
  }

  const account = me.data;
  const needsTerms = account.termsCurrent === false;
  const context: PortalSignedInContext = { slug, token: sessionToken, brand, me: account, expire: forget };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await portalApi.signOut(sessionToken);
    } catch {
      // The session is forgotten on this device either way.
    }
    clearPortalDraft(slug);
    forget();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-body-sm text-text-muted">
          Signed in as {account.partnerName} at {account.orgName}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {!needsTerms && (
            <Link
              to={portalPath(slug, `/profile`)}
              className="inline-flex min-h-11 items-center gap-1 rounded-radius-sm px-2 text-body-sm font-medium text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
            >
              <User className="h-4 w-4" aria-hidden />
              Profile
            </Link>
          )}
          <Button
            variant="tertiary"
            size="lg"
            leadingIcon={LogOut}
            loading={signingOut}
            onClick={() => void signOut()}
            className="shrink-0"
          >
            Sign out
          </Button>
        </div>
      </div>
      {needsTerms ? (
        <PortalTermsPage
          slug={slug}
          token={sessionToken}
          brand={brand}
          onAccepted={termsAccepted}
          onExpired={forget}
        />
      ) : (
        <Outlet context={context} />
      )}
    </div>
  );
}
