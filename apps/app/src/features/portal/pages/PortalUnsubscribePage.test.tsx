import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({ brand: vi.fn(), unsubscribeDigest: vi.fn() }));

vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: api };
});

import { PortalRoot } from "./PortalRoot";
import { PortalApiError } from "../lib/portalApi";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";

// Node 25 ships a broken global localStorage: install an in-memory Storage per test.
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

afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
});

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/p/:slug/*" element={<PortalRoot />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), writable: true, configurable: true });
  api.brand.mockReset();
  api.unsubscribeDigest.mockReset();
  api.brand.mockResolvedValue({ orgName: "Acme ISO", productName: "Acme", primaryColor: null, logoUrl: null, darkLogoUrl: null });
});

describe("PortalUnsubscribePage", () => {
  it("asks first and changes nothing until the button is pressed", async () => {
    renderAt(`/p/acme/unsubscribe?t=${TOKEN}`);
    expect(await screen.findByRole("heading", { name: "Stop the weekly summary?" })).toBeInTheDocument();
    expect(screen.getByText("You'll stop getting the weekly summary email from Acme ISO. Emails about your referrals still arrive.")).toBeInTheDocument();
    expect(api.unsubscribeDigest).not.toHaveBeenCalled();
  });

  it("unsubscribes with the slug and token, then confirms", async () => {
    const user = userEvent.setup();
    api.unsubscribeDigest.mockResolvedValue(undefined);
    renderAt(`/p/acme/unsubscribe?t=${TOKEN}`);
    await user.click(await screen.findByRole("button", { name: "Unsubscribe" }));
    expect(api.unsubscribeDigest).toHaveBeenCalledWith("acme", TOKEN);
    expect(await screen.findByRole("heading", { name: "You're unsubscribed" })).toBeInTheDocument();
    expect(screen.getByText("You won't get the weekly summary. You can turn it back on in your profile.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unsubscribe" })).toBeNull();
  });

  it("says so when it could not reach the ISO, and lets the partner try again", async () => {
    const user = userEvent.setup();
    api.unsubscribeDigest.mockRejectedValueOnce(new PortalApiError(500, "server_error")).mockResolvedValueOnce(undefined);
    renderAt(`/p/acme/unsubscribe?t=${TOKEN}`);
    await user.click(await screen.findByRole("button", { name: "Unsubscribe" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't reach Acme ISO. Check your connection and try again.");
    await user.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect(await screen.findByRole("heading", { name: "You're unsubscribed" })).toBeInTheDocument();
  });

  it("explains a link without a token and offers no button", async () => {
    renderAt("/p/acme/unsubscribe");
    expect(await screen.findByRole("heading", { name: "This link isn't complete" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unsubscribe" })).toBeNull();
  });
});
