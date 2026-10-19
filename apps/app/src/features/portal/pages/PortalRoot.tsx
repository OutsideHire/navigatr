/**
 * PortalRoot: the partner portal's route tree, mounted at /p/:slug/* outside
 * ProtectedRoute and PublicOnlyRoute (spec 5.11). Partners have no Supabase
 * session; this tree only talks to portal_api.
 *
 * Branding loads first, with no session (spec 5.4). An unknown or disabled slug
 * renders a generic page with no tenant detail.
 *
 * The public referral form (Phase 2B-1) lives at refer/:token and needs no session.
 * The weekly summary opt-out lives at unsubscribe and needs no session (Phase 2B-3).
 */
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { isPortalTransientError, portalApi } from "../lib/portalApi";
import { PortalBrandProvider } from "../PortalBrandProvider";
import { PortalShell } from "../components/PortalShell";
import { PortalUnavailablePage } from "./PortalUnavailablePage";
import { PortalRetry } from "../components/PortalRetry";
import { PortalSignInPage } from "./PortalSignInPage";
import { PortalInvitePage } from "./PortalInvitePage";
import { PortalSignedInLayout } from "../components/PortalSignedInLayout";
import { PortalDashboardPage } from "./PortalDashboardPage";
import { PortalSubmitPage } from "./PortalSubmitPage";
import { PortalReferralPage } from "./PortalReferralPage";
import { PortalProfilePage } from "./PortalProfilePage";
import { PortalPublicFormPage } from "./PortalPublicFormPage";
import { PortalUnsubscribePage } from "./PortalUnsubscribePage";

export function PortalRoot() {
  const { slug: rawSlug = "" } = useParams<{ slug: string }>();
  const slug = rawSlug.trim().toLowerCase();

  const brand = useQuery({
    queryKey: ["portal", "brand", slug],
    queryFn: () => portalApi.brand(slug),
    retry: false,
    staleTime: 5 * 60_000,
  });

  if (brand.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-canvas">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
      </div>
    );
  }
  if (brand.isError && isPortalTransientError(brand.error)) {
    return <PortalRetry fullPage onRetry={() => void brand.refetch()} busy={brand.isFetching} />;
  }
  if (brand.isError || !brand.data) return <PortalUnavailablePage />;

  const data = brand.data;
  return (
    <PortalBrandProvider brand={data}>
      <PortalShell brand={data}>
        <Routes>
          <Route index element={<PortalSignInPage slug={slug} brand={data} />} />
          <Route path="invite" element={<PortalInvitePage slug={slug} brand={data} />} />
          <Route path="refer/:token" element={<PortalPublicFormPage slug={slug} brand={data} />} />
          <Route path="unsubscribe" element={<PortalUnsubscribePage slug={slug} brand={data} />} />
          <Route element={<PortalSignedInLayout slug={slug} brand={data} />}>
            <Route path="home" element={<PortalDashboardPage />} />
            <Route path="new" element={<PortalSubmitPage />} />
            <Route path="r/:referralId" element={<PortalReferralPage />} />
            <Route path="profile" element={<PortalProfilePage />} />
          </Route>
          <Route path="*" element={<Navigate to={`/p/${slug}`} replace />} />
        </Routes>
      </PortalShell>
    </PortalBrandProvider>
  );
}
