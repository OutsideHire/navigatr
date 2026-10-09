/**
 * Signed-in landing page (Phase 1A). Proves the session works and lets the
 * partner sign out. Referral submission and tracking arrive in Phase 1B.
 */
import * as React from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, LogOut } from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import { portalApi } from "../lib/portalApi";
import { clearPortalSession, readPortalSession } from "../lib/portalSession";

export function PortalHomePage({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const [token] = React.useState(() => readPortalSession(slug));
  const [signingOut, setSigningOut] = React.useState(false);

  const me = useQuery({
    queryKey: ["portal", "me", slug, token],
    queryFn: () => portalApi.me(slug, token ?? ""),
    enabled: Boolean(token),
    retry: false,
  });

  const expired = me.isSuccess && me.data === null;
  React.useEffect(() => {
    if (!expired) return;
    clearPortalSession(slug);
    navigate(`/p/${slug}`, { replace: true });
  }, [expired, slug, navigate]);

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
    return (
      <Card padding="lg" className="flex flex-col gap-3">
        <p className="text-body-md text-text-default">
          We couldn&apos;t load your account. Check your connection and try again.
        </p>
        <Button variant="secondary" size="md" onClick={() => void me.refetch()}>
          Try again
        </Button>
      </Card>
    );
  }

  const account = me.data;

  const signOut = async () => {
    setSigningOut(true);
    try {
      await portalApi.signOut(sessionToken);
    } catch {
      // The session is forgotten on this device either way.
    }
    clearPortalSession(slug);
    navigate(`/p/${slug}`, { replace: true });
  };

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <h1 className="text-heading-lg text-text-default">You&apos;re signed in</h1>
      <p className="text-body-md text-text-default">
        Signed in as {account.partnerName} at {account.orgName}
      </p>
      <p className="text-body-md text-text-muted">
        Soon you&apos;ll be able to send referrals and follow each one here.
      </p>
      <Button
        variant="secondary"
        size="lg"
        fullWidth
        leadingIcon={LogOut}
        loading={signingOut}
        onClick={() => void signOut()}
      >
        Sign out
      </Button>
    </Card>
  );
}
