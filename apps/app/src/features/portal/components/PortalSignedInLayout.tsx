/**
 * PortalSignedInLayout: every signed-in portal page sits inside this layout
 * route. It checks the session once (me), shows who is signed in with a Sign out
 * button, and hands the pages their context. Any page that gets a 401 calls
 * expire(), which forgets the session on this device and returns to sign-in.
 * An expiry keeps an unsent referral draft so nothing typed is lost; an
 * explicit Sign out also clears it, since the device may be shared.
 */
import * as React from "react";
import { Navigate, Outlet, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/navigatr";
import { PortalRetry } from "./PortalRetry";
import { portalApi, type PortalBrand } from "../lib/portalApi";
import { clearPortalDraft } from "../lib/portalDraft";
import { clearPortalSession, readPortalSession } from "../lib/portalSession";
import type { PortalSignedInContext } from "../lib/portalSignedIn";

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
    navigate(`/p/${slug}`, { replace: true });
  }, [slug, queryClient, navigate]);

  const expired = me.isSuccess && me.data === null;
  React.useEffect(() => {
    if (expired) forget();
  }, [expired, forget]);

  if (!token) return <Navigate to={`/p/${slug}`} replace />;
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
      <Outlet context={context} />
    </div>
  );
}
