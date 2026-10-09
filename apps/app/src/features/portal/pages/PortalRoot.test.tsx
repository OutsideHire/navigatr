import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
import { clearPortalSession, readPortalSession, writePortalSession } from "../lib/portalSession";

const BRAND = { orgName: "Acme ISO", productName: "navigatr", primaryColor: null, logoUrl: null, darkLogoUrl: null };
const ME = { partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" };

function renderAt(path: string, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/p/:slug/*" element={<PortalRoot />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Node 25 ships a broken global localStorage, so install an in-memory Storage
// per test and restore the original afterwards.
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
  clearPortalSession("acme");
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
});

describe("PortalRoot", () => {
  it("shows a generic page with no tenant detail for an unknown or disabled portal", async () => {
    api.brand.mockResolvedValue(null);
    renderAt("/p/nope");
    expect(await screen.findByRole("heading", { name: "This portal isn't available" })).toBeInTheDocument();
    expect(screen.queryByText(/acme/i)).toBeNull();
    expect(api.brand).toHaveBeenCalledWith("nope");
  });

  it("signs a partner in with an email code and lands on the home page", async () => {
    const user = userEvent.setup();
    api.brand.mockResolvedValue(BRAND);
    api.requestCode.mockResolvedValue(undefined);
    api.verifyCode.mockResolvedValue({ sessionToken: "s".repeat(64), expiresAt: "2026-11-08T00:00:00Z" });
    api.me.mockResolvedValue(ME);

    renderAt("/p/acme");
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(screen.queryByText(/navigatr/i)).toBeNull();

    await user.type(screen.getByLabelText("Email"), "jane@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    expect(api.requestCode).toHaveBeenCalledWith("acme", "jane@example.com");
    expect(await screen.findByText(/we sent a 6-digit code/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(api.verifyCode).toHaveBeenCalledWith("acme", "jane@example.com", "123456");

    expect(await screen.findByText("Signed in as Jane at Acme ISO")).toBeInTheDocument();
    expect(api.me).toHaveBeenCalledWith("acme", "s".repeat(64));
    expect(readPortalSession("acme")).toBe("s".repeat(64));
  });

  it("asks for a valid email before sending a code", async () => {
    const user = userEvent.setup();
    api.brand.mockResolvedValue(BRAND);
    renderAt("/p/acme");
    await user.type(await screen.findByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid email address.");
    expect(api.requestCode).not.toHaveBeenCalled();
  });

  it("says plainly when a code is wrong", async () => {
    const user = userEvent.setup();
    api.brand.mockResolvedValue(BRAND);
    api.requestCode.mockResolvedValue(undefined);
    api.verifyCode.mockRejectedValue(new PortalApiError(401, "invalid_code"));

    renderAt("/p/acme");
    await user.type(await screen.findByLabelText("Email"), "jane@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    await user.type(await screen.findByLabelText("6-digit code"), "000000");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That code didn't work. Check it, or send a new one.");
    expect(readPortalSession("acme")).toBeNull();
  });

  it("sends a partner with an expired session back to sign-in and forgets it", async () => {
    api.brand.mockResolvedValue(BRAND);
    api.me.mockResolvedValue(null);
    writePortalSession("acme", "old");

    renderAt("/p/acme/home");
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(readPortalSession("acme")).toBeNull();
  });

  it("goes straight to home when a session is already stored", async () => {
    api.brand.mockResolvedValue(BRAND);
    api.me.mockResolvedValue(ME);
    writePortalSession("acme", "live");

    renderAt("/p/acme");
    expect(await screen.findByText("Signed in as Jane at Acme ISO")).toBeInTheDocument();
  });

  it("signs out, revoking the session server-side", async () => {
    const user = userEvent.setup();
    api.brand.mockResolvedValue(BRAND);
    api.me.mockResolvedValue(ME);
    api.signOut.mockResolvedValue(undefined);
    writePortalSession("acme", "live");

    renderAt("/p/acme/home");
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(api.signOut).toHaveBeenCalledWith("live");
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(readPortalSession("acme")).toBeNull();
  });

  it("forgets the session on this device even when the server sign-out fails", async () => {
    const user = userEvent.setup();
    api.brand.mockResolvedValue(BRAND);
    api.me.mockResolvedValue(ME);
    api.signOut.mockRejectedValue(new Error("offline"));
    writePortalSession("acme", "live");

    renderAt("/p/acme/home");
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(readPortalSession("acme")).toBeNull();
  });

  it("offers a retry, not 'unavailable', when the portal can't be reached", async () => {
    const user = userEvent.setup();
    api.brand.mockRejectedValueOnce(new PortalApiError(0, "network_error")).mockResolvedValue(BRAND);
    renderAt("/p/acme");
    expect(await screen.findByText("We couldn't reach the portal. Check your connection and try again.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "This portal isn't available" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(api.brand).toHaveBeenCalledTimes(2);
  });

  it("offers a retry on a 5xx or an unexpected error from branding", async () => {
    api.brand.mockRejectedValue(new PortalApiError(503, "server_error"));
    renderAt("/p/acme");
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("still shows 'unavailable' for a genuine client error from branding", async () => {
    api.brand.mockRejectedValue(new PortalApiError(400, "invalid_body"));
    renderAt("/p/acme");
    expect(await screen.findByRole("heading", { name: "This portal isn't available" })).toBeInTheDocument();
  });

  it("says the ISO can't be reached, not that the code is wrong, when verify fails on the network", async () => {
    const user = userEvent.setup();
    api.brand.mockResolvedValue(BRAND);
    api.requestCode.mockResolvedValue(undefined);
    api.verifyCode
      .mockRejectedValueOnce(new PortalApiError(0, "network_error"))
      .mockResolvedValueOnce({ sessionToken: "s".repeat(64), expiresAt: "2026-11-08T00:00:00Z" });
    api.me.mockResolvedValue(ME);

    renderAt("/p/acme");
    await user.type(await screen.findByLabelText("Email"), "jane@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    await user.type(await screen.findByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach Acme ISO. Check your connection and try again.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Signed in as Jane at Acme ISO")).toBeInTheDocument();
    expect(api.verifyCode).toHaveBeenCalledTimes(2);
  });

  it("offers a retry when sending the code fails on the network", async () => {
    const user = userEvent.setup();
    api.brand.mockResolvedValue(BRAND);
    api.requestCode.mockRejectedValueOnce(new PortalApiError(502, "request_failed")).mockResolvedValueOnce(undefined);

    renderAt("/p/acme");
    await user.type(await screen.findByLabelText("Email"), "jane@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach Acme ISO. Check your connection and try again.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/we sent a 6-digit code/i)).toBeInTheDocument();
  });

  it("offers a retry on home when the account can't be reached", async () => {
    const user = userEvent.setup();
    api.brand.mockResolvedValue(BRAND);
    api.me.mockRejectedValueOnce(new PortalApiError(500, "server_error")).mockResolvedValueOnce(ME);
    writePortalSession("acme", "live");

    renderAt("/p/acme/home");
    expect(await screen.findByText("We couldn't reach Acme ISO. Check your connection and try again.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Signed in as Jane at Acme ISO")).toBeInTheDocument();
    expect(readPortalSession("acme")).toBe("live");
  });

  it("removes the cached account on sign-out", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.brand.mockResolvedValue(BRAND);
    api.me.mockResolvedValue(ME);
    api.signOut.mockResolvedValue(undefined);
    writePortalSession("acme", "live");

    renderAt("/p/acme/home", client);
    await screen.findByText("Signed in as Jane at Acme ISO");
    expect(client.getQueryCache().findAll({ queryKey: ["portal", "me", "acme"] })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("heading", { name: "Sign in to Acme ISO" });
    expect(client.getQueryCache().findAll({ queryKey: ["portal", "me", "acme"] })).toHaveLength(0);
  });
});
