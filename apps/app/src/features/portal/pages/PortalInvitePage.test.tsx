import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  brand: vi.fn(),
  requestCode: vi.fn(),
  verifyCode: vi.fn(),
  peekInvite: vi.fn(),
  acceptInvite: vi.fn(),
  me: vi.fn(),
  signOut: vi.fn(),
  form: vi.fn(),
  dupCheck: vi.fn(),
  submitReferral: vi.fn(),
  listReferrals: vi.fn(),
  dashboard: vi.fn(),
  getReferral: vi.fn(),
  withdrawReferral: vi.fn(),
  transcribe: vi.fn(),
}));

const EMPTY_DASHBOARD = { submitted: 0, active: 0, closedWon: 0, conversionRate: null, valueVisible: false };

vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: api };
});

import { PortalRoot } from "./PortalRoot";
import { PortalApiError } from "../lib/portalApi";
import { clearPortalSession, readPortalSession } from "../lib/portalSession";
import {
  NAVIGATR_PORTAL_TERMS_TEXT,
  NAVIGATR_PORTAL_TERMS_VERSION,
} from "../../../../../../supabase/functions/_shared/portalNavigatrTerms";

const BRAND = { orgName: "Acme ISO", productName: "navigatr", primaryColor: null, logoUrl: null, darkLogoUrl: null };
const NV = NAVIGATR_PORTAL_TERMS_VERSION;
const INVITE = {
  partnerName: "Jane",
  orgName: "Acme ISO",
  termsText: "Be fair.",
  termsVersion: 2,
  navigatrTermsText: NAVIGATR_PORTAL_TERMS_TEXT,
  navigatrTermsVersion: NV,
};
const AGREE = "I agree to the Navigatr Referral Portal Terms and Acme ISO's partner terms";

let currentLocation = "";
function LocationProbe() {
  const loc = useLocation();
  currentLocation = `${loc.pathname}${loc.search}${loc.hash}`;
  return null;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route path="/p/:slug/*" element={<PortalRoot />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}


const origLocalStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
})();

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, v),
  };
}

// sessionStorage gets the same per-test in-memory shim as localStorage.
const origSessionStorage = (() => {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
})();

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), writable: true, configurable: true });
  Object.defineProperty(window, "sessionStorage", { value: memoryStorage(), writable: true, configurable: true });
  Object.values(api).forEach((fn) => fn.mockReset());
  api.brand.mockResolvedValue(BRAND);
  api.dashboard.mockResolvedValue(EMPTY_DASHBOARD);
  api.listReferrals.mockResolvedValue([]);
  clearPortalSession("acme");
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
  Object.defineProperty(window, "sessionStorage", { value: origSessionStorage, writable: true, configurable: true });
});

describe("PortalInvitePage", () => {
  it("shows the ISO's terms and only accepts once the partner agrees", async () => {
    const user = userEvent.setup();
    api.peekInvite.mockResolvedValue(INVITE);
    api.acceptInvite.mockResolvedValue({ sessionToken: "s".repeat(64), expiresAt: "2026-11-08T00:00:00Z" });
    api.me.mockResolvedValue({ partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" });

    renderAt("/p/acme/invite?token=tok");
    expect(await screen.findByRole("heading", { name: "Welcome, Jane" })).toBeInTheDocument();
    expect(api.peekInvite).toHaveBeenCalledWith("acme", "tok");
    expect(screen.getByText("Be fair.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Navigatr Referral Portal Terms" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Partner terms" })).toBeInTheDocument();
    expect(screen.getByText(/Information obtained through the portal must be used only for authorized referral-related/)).toBeInTheDocument();

    const accept = screen.getByRole("button", { name: "Accept and continue" });
    expect(accept).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: AGREE }));
    expect(accept).toBeEnabled();
    await user.click(accept);

    expect(api.acceptInvite).toHaveBeenCalledWith("acme", "tok", 2, NV);
    expect(await screen.findByText("Signed in as Jane at Acme ISO")).toBeInTheDocument();
    expect(readPortalSession("acme")).toBe("s".repeat(64));
  });

  it("reloads the terms and asks again when they changed", async () => {
    const user = userEvent.setup();
    api.peekInvite
      .mockResolvedValueOnce(INVITE)
      .mockResolvedValueOnce({ ...INVITE, termsText: "New terms.", termsVersion: 3 });
    api.acceptInvite.mockRejectedValueOnce(new PortalApiError(409, "terms_changed"));

    renderAt("/p/acme/invite?token=tok");
    await user.click(await screen.findByRole("checkbox", { name: AGREE }));
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The terms were just updated. Please read them again.");
    expect(await screen.findByText("New terms.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: AGREE })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Accept and continue" })).toBeDisabled();
    expect(readPortalSession("acme")).toBeNull();
  });

  it("asks for only the navigatr terms when the ISO has no partner terms", async () => {
    const user = userEvent.setup();
    api.peekInvite.mockResolvedValue({ ...INVITE, termsText: "", termsVersion: 0 });
    api.acceptInvite.mockResolvedValue({ sessionToken: "s".repeat(64), expiresAt: "2026-11-08T00:00:00Z" });
    api.me.mockResolvedValue({ partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" });

    renderAt("/p/acme/invite?token=tok");
    expect(await screen.findByRole("heading", { name: "Navigatr Referral Portal Terms" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Partner terms" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "I agree to the Navigatr Referral Portal Terms" }));
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));
    expect(api.acceptInvite).toHaveBeenCalledWith("acme", "tok", 0, NV);
  });

  it("explains an expired or used invite", async () => {
    api.peekInvite.mockResolvedValue(null);
    renderAt("/p/acme/invite?token=old");
    expect(
      await screen.findByRole("heading", { name: "This invite link has expired or was already used" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Ask your contact at Acme ISO/)).toBeInTheDocument();
  });

  it("treats a link with no token as expired without calling the server", async () => {
    renderAt("/p/acme/invite");
    expect(
      await screen.findByRole("heading", { name: "This invite link has expired or was already used" }),
    ).toBeInTheDocument();
    expect(api.peekInvite).not.toHaveBeenCalled();
  });

  it("moves the token out of the address bar and still uses it for peek and accept", async () => {
    const user = userEvent.setup();
    api.peekInvite.mockResolvedValue(INVITE);
    api.acceptInvite.mockResolvedValue({ sessionToken: "s".repeat(64), expiresAt: "2026-11-08T00:00:00Z" });
    api.me.mockResolvedValue({ partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" });

    renderAt("/p/acme/invite?token=secret-tok");
    expect(await screen.findByRole("heading", { name: "Welcome, Jane" })).toBeInTheDocument();
    expect(currentLocation).toBe("/p/acme/invite");
    expect(api.peekInvite).toHaveBeenCalledWith("acme", "secret-tok");
    expect(api.peekInvite).not.toHaveBeenCalledWith("acme", "");

    await user.click(screen.getByRole("checkbox", { name: AGREE }));
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));
    expect(api.acceptInvite).toHaveBeenCalledWith("acme", "secret-tok", 2, NV);
  });

  it("offers a retry, not 'expired', when the invite can't be checked", async () => {
    const user = userEvent.setup();
    api.peekInvite.mockRejectedValueOnce(new PortalApiError(0, "network_error")).mockResolvedValueOnce(INVITE);

    renderAt("/p/acme/invite?token=tok");
    expect(await screen.findByText("We couldn't reach Acme ISO. Check your connection and try again.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "This invite link has expired or was already used" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Welcome, Jane" })).toBeInTheDocument();
    expect(api.peekInvite).toHaveBeenLastCalledWith("acme", "tok");
  });

  it("offers a retry, not 'can't be used', when accepting fails on the network or a 5xx", async () => {
    const user = userEvent.setup();
    api.peekInvite.mockResolvedValue(INVITE);
    api.acceptInvite
      .mockRejectedValueOnce(new PortalApiError(500, "server_error"))
      .mockResolvedValueOnce({ sessionToken: "s".repeat(64), expiresAt: "2026-11-08T00:00:00Z" });
    api.me.mockResolvedValue({ partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" });

    renderAt("/p/acme/invite?token=tok");
    await user.click(await screen.findByRole("checkbox", { name: AGREE }));
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach Acme ISO. Check your connection and try again.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(/can't be used/);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Signed in as Jane at Acme ISO")).toBeInTheDocument();
    expect(api.acceptInvite).toHaveBeenCalledTimes(2);
  });

  it("still says the invite can't be used for a genuine invalid invite", async () => {
    const user = userEvent.setup();
    api.peekInvite.mockResolvedValue(INVITE);
    api.acceptInvite.mockRejectedValue(new PortalApiError(404, "invalid_invite"));
    renderAt("/p/acme/invite?token=tok");
    await user.click(await screen.findByRole("checkbox", { name: AGREE }));
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This invite can't be used anymore.");
  });
  it("keeps the invite when the terms screen is reloaded", async () => {
    api.peekInvite.mockResolvedValue(INVITE);
    const first = renderAt("/p/acme/invite?token=tok-reload");
    expect(await screen.findByRole("heading", { name: "Welcome, Jane" })).toBeInTheDocument();
    expect(window.sessionStorage.getItem("navigatr-portal-invite:acme")).toBe("tok-reload");
    first.unmount();

    // A reload lands on the cleaned address, with no token in it.
    renderAt("/p/acme/invite");
    expect(await screen.findByRole("heading", { name: "Welcome, Jane" })).toBeInTheDocument();
    expect(api.peekInvite).toHaveBeenLastCalledWith("acme", "tok-reload");
  });

  it("forgets the pending invite once it is accepted", async () => {
    const user = userEvent.setup();
    api.peekInvite.mockResolvedValue(INVITE);
    api.acceptInvite.mockResolvedValue({ sessionToken: "s".repeat(64), expiresAt: "2026-11-08T00:00:00Z" });
    api.me.mockResolvedValue({ partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" });
    renderAt("/p/acme/invite?token=tok");
    await user.click(await screen.findByRole("checkbox", { name: AGREE }));
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));
    expect(await screen.findByText("Signed in as Jane at Acme ISO")).toBeInTheDocument();
    expect(window.sessionStorage.getItem("navigatr-portal-invite:acme")).toBeNull();
  });

  it("forgets a stored invite once the server says it is invalid", async () => {
    api.peekInvite.mockResolvedValue(null);
    window.sessionStorage.setItem("navigatr-portal-invite:acme", "tok-dead");
    renderAt("/p/acme/invite");
    expect(
      await screen.findByRole("heading", { name: "This invite link has expired or was already used" }),
    ).toBeInTheDocument();
    expect(api.peekInvite).toHaveBeenCalledWith("acme", "tok-dead");
    expect(window.sessionStorage.getItem("navigatr-portal-invite:acme")).toBeNull();
  });

  it("never uses another portal's pending invite", async () => {
    window.sessionStorage.setItem("navigatr-portal-invite:other", "tok-other");
    renderAt("/p/acme/invite");
    expect(
      await screen.findByRole("heading", { name: "This invite link has expired or was already used" }),
    ).toBeInTheDocument();
    expect(api.peekInvite).not.toHaveBeenCalled();
  });
});
