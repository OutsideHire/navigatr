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
}));

vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: api };
});

import { PortalRoot } from "./PortalRoot";
import { PortalApiError } from "../lib/portalApi";
import { clearPortalSession, readPortalSession } from "../lib/portalSession";

const BRAND = { orgName: "Acme ISO", productName: "navigatr", primaryColor: null, logoUrl: null, darkLogoUrl: null };
const INVITE = { partnerName: "Jane", orgName: "Acme ISO", termsText: "Be fair.", termsVersion: 2 };

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

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), writable: true, configurable: true });
  Object.values(api).forEach((fn) => fn.mockReset());
  api.brand.mockResolvedValue(BRAND);
  clearPortalSession("acme");
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
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

    const accept = screen.getByRole("button", { name: "Accept and continue" });
    expect(accept).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "I agree to these terms" }));
    expect(accept).toBeEnabled();
    await user.click(accept);

    expect(api.acceptInvite).toHaveBeenCalledWith("acme", "tok", 2);
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
    await user.click(await screen.findByRole("checkbox", { name: "I agree to these terms" }));
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The terms were just updated. Please read them again.");
    expect(await screen.findByText("New terms.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "I agree to these terms" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Accept and continue" })).toBeDisabled();
    expect(readPortalSession("acme")).toBeNull();
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

    await user.click(screen.getByRole("checkbox", { name: "I agree to these terms" }));
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));
    expect(api.acceptInvite).toHaveBeenCalledWith("acme", "secret-tok", 2);
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
    await user.click(await screen.findByRole("checkbox", { name: "I agree to these terms" }));
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
    await user.click(await screen.findByRole("checkbox", { name: "I agree to these terms" }));
    await user.click(screen.getByRole("button", { name: "Accept and continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This invite can't be used anymore.");
  });
});
