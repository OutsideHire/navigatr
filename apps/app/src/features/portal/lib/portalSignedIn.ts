/**
 * What the signed-in layout hands its pages: the tenant, the session token, the
 * partner, and `expire()`, which forgets the session on this device and returns
 * to sign-in (call it when any request answers 401).
 */
import { useOutletContext } from "react-router-dom";
import type { PortalBrand, PortalMe } from "./portalApi";

export interface PortalSignedInContext {
  slug: string;
  token: string;
  brand: PortalBrand;
  me: PortalMe;
  expire: () => void;
}

export function usePortalSignedIn(): PortalSignedInContext {
  return useOutletContext<PortalSignedInContext>();
}
