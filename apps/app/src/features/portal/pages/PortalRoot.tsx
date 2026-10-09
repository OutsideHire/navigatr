/**
 * PortalRoot: the partner portal's route tree, mounted at /p/:slug/* outside
 * ProtectedRoute and PublicOnlyRoute (spec 5.11). Partners have no Supabase
 * session; this tree only talks to portal_api.
 *
 * Branding loads first, with no session (spec 5.4). An unknown or disabled slug
 * renders a generic page with no tenant detail.
 */
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { portalApi } from "../lib/portalApi";
import { PortalBrandProvider } from "../PortalBrandProvider";
import { PortalShell } from "../components/PortalShell";
import { PortalUnavailablePage } from "./PortalUnavailablePage";
import { PortalSignInPage } from "./PortalSignInPage";
import { PortalHomePage } from "./PortalHomePage";
import { PortalInvitePage } from "./PortalInvitePage";

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
  if (brand.isError || !brand.data) return <PortalUnavailablePage />;

  const data = brand.data;
  return (
    <PortalBrandProvider brand={data}>
      <PortalShell brand={data}>
        <Routes>
          <Route index element={<PortalSignInPage slug={slug} brand={data} />} />
          <Route path="invite" element={<PortalInvitePage slug={slug} brand={data} />} />
          <Route path="home" element={<PortalHomePage slug={slug} />} />
          <Route path="*" element={<Navigate to={`/p/${slug}`} replace />} />
        </Routes>
      </PortalShell>
    </PortalBrandProvider>
  );
}
