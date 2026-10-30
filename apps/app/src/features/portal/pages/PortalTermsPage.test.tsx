import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  getTerms: vi.fn(),
  acceptTerms: vi.fn(),
}));

vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: api };
});

import { PortalTermsPage } from "./PortalTermsPage";
import { PortalApiError, portalDataKey } from "../lib/portalApi";
import {
  NAVIGATR_PORTAL_TERMS_TEXT,
  NAVIGATR_PORTAL_TERMS_VERSION,
} from "../../../../../../supabase/functions/_shared/portalNavigatrTerms";

const BRAND = { orgName: "Acme ISO", productName: "navigatr", primaryColor: null, logoUrl: null, darkLogoUrl: null };
const NV = NAVIGATR_PORTAL_TERMS_VERSION;
const TERMS = {
  termsText: "Terms two.",
  termsVersion: 2,
  termsCurrent: false,
  navigatrTermsText: NAVIGATR_PORTAL_TERMS_TEXT,
  navigatrTermsVersion: NV,
};
const AGREE = "I agree to the Navigatr Referral Portal Terms and Acme ISO's partner terms";

function renderPage(prime?: (client: QueryClient) => void) {
  const onAccepted = vi.fn();
  const onExpired = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  prime?.(client);
  render(
    <QueryClientProvider client={client}>
      <PortalTermsPage slug="acme" token="sess" brand={BRAND} onAccepted={onAccepted} onExpired={onExpired} />
    </QueryClientProvider>,
  );
  return { onAccepted, onExpired };
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
});

describe("PortalTermsPage", () => {
  it("shows the navigatr terms first, then the ISO's new terms, and accepts both only once the partner agrees", async () => {
    const user = userEvent.setup();
    api.getTerms.mockResolvedValue(TERMS);
    api.acceptTerms.mockResolvedValue(undefined);
    const { onAccepted } = renderPage();

    expect(await screen.findByRole("heading", { name: "The portal terms were updated" })).toBeInTheDocument();
    expect(api.getTerms).toHaveBeenCalledWith("acme", "sess");
    expect(screen.getByText("Terms two.")).toBeInTheDocument();
    const navigatrHeading = screen.getByRole("heading", { name: "Navigatr Referral Portal Terms" });
    const isoHeading = screen.getByRole("heading", { name: "Partner terms" });
    // navigatr's terms come first.
    expect(navigatrHeading.compareDocumentPosition(isoHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/does not guarantee referral acceptance, conversion, or resulting business opportunities/)).toBeInTheDocument();

    const accept = screen.getByRole("button", { name: "Accept and continue" });
    expect(accept).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: AGREE }));
    await user.click(accept);

    expect(api.acceptTerms).toHaveBeenCalledWith("acme", "sess", 2, NV);
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });

  it("stops spinning after a successful accept even if the page stays up (the me() re-check failed)", async () => {
    const user = userEvent.setup();
    api.getTerms.mockResolvedValue(TERMS);
    api.acceptTerms.mockResolvedValue(undefined);
    const { onAccepted } = renderPage();

    await user.click(await screen.findByRole("checkbox", { name: AGREE }));
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));
    expect(onAccepted).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Accept and continue" })).toBeEnabled());
  });

  it("does not trust a cached 'current' answer from an earlier visit when the terms changed again", async () => {
    api.getTerms.mockResolvedValue(TERMS);
    const { onAccepted } = renderPage((client) =>
      client.setQueryData(portalDataKey("acme", "sess", "terms"), { ...TERMS, termsVersion: 1, termsCurrent: true }),
    );
    expect(await screen.findByText("Terms two.")).toBeInTheDocument();
    expect(api.getTerms).toHaveBeenCalledTimes(1);
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("reloads the terms and asks again when they changed while the partner was reading", async () => {
    const user = userEvent.setup();
    api.getTerms.mockResolvedValueOnce(TERMS).mockResolvedValueOnce({ ...TERMS, termsText: "Terms three.", termsVersion: 3 });
    api.acceptTerms.mockRejectedValueOnce(new PortalApiError(409, "terms_changed"));
    const { onAccepted } = renderPage();

    await user.click(await screen.findByRole("checkbox", { name: AGREE }));
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The terms were just updated. Please read them again.");
    expect(await screen.findByText("Terms three.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: AGREE })).not.toBeChecked();
    expect(onAccepted).not.toHaveBeenCalled();

    api.acceptTerms.mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole("checkbox", { name: AGREE }));
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));
    expect(api.acceptTerms).toHaveBeenLastCalledWith("acme", "sess", 3, NV);
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });

  it("asks for only the navigatr terms when the ISO has no partner terms", async () => {
    const user = userEvent.setup();
    api.getTerms.mockResolvedValue({ ...TERMS, termsText: "", termsVersion: 0 });
    api.acceptTerms.mockResolvedValue(undefined);
    const { onAccepted } = renderPage();

    expect(await screen.findByRole("heading", { name: "Navigatr Referral Portal Terms" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Partner terms" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "I agree to the Navigatr Referral Portal Terms" }));
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));
    expect(api.acceptTerms).toHaveBeenCalledWith("acme", "sess", 0, NV);
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });

  it("offers a retry when accepting can't reach the ISO", async () => {
    const user = userEvent.setup();
    api.getTerms.mockResolvedValue(TERMS);
    api.acceptTerms.mockRejectedValueOnce(new PortalApiError(0, "network_error")).mockResolvedValueOnce(undefined);
    const { onAccepted } = renderPage();

    await user.click(await screen.findByRole("checkbox", { name: AGREE }));
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Acme ISO/);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });

  it("returns to sign-in when the session is gone", async () => {
    api.getTerms.mockResolvedValue(null);
    const { onExpired } = renderPage();
    await vi.waitFor(() => expect(onExpired).toHaveBeenCalled());
  });

  it("returns to sign-in when the session dies while accepting", async () => {
    const user = userEvent.setup();
    api.getTerms.mockResolvedValue(TERMS);
    api.acceptTerms.mockRejectedValueOnce(new PortalApiError(401, "unauthorized"));
    const { onExpired, onAccepted } = renderPage();
    await user.click(await screen.findByRole("checkbox", { name: AGREE }));
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));
    await vi.waitFor(() => expect(onExpired).toHaveBeenCalled());
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("moves on without asking when the terms are already current (accepted on another device)", async () => {
    api.getTerms.mockResolvedValue({ ...TERMS, termsCurrent: true });
    const { onAccepted } = renderPage();
    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(api.acceptTerms).not.toHaveBeenCalled();
  });

  it("offers a retry when the terms can't be loaded", async () => {
    api.getTerms.mockRejectedValue(new PortalApiError(503, "server_error"));
    renderPage();
    expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
