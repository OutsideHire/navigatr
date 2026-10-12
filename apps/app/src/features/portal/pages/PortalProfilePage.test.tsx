import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  form: vi.fn(),
  dupCheck: vi.fn(),
  submitReferral: vi.fn(),
  listReferrals: vi.fn(),
  dashboard: vi.fn(),
  getReferral: vi.fn(),
  withdrawReferral: vi.fn(),
  transcribe: vi.fn(),
  exportReferrals: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: api };
});

import { PortalRoot } from "./PortalRoot";
import { PortalApiError } from "../lib/portalApi";
import { writePortalSession } from "../lib/portalSession";
import { PORTAL_PROFILE_MESSAGES } from "../../../../../../supabase/functions/_shared/portalProfile";

const BRAND = { orgName: "Acme ISO", productName: "Acme", primaryColor: null, logoUrl: null, darkLogoUrl: null };
const ME = { partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" };
const PROFILE = { name: "Jane", phone: "5550100100", email: "jane@example.com", weeklyDigest: true };

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
  return client;
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), writable: true, configurable: true });
  Object.values(api).forEach((fn) => fn.mockReset());
  api.brand.mockResolvedValue(BRAND);
  api.me.mockResolvedValue(ME);
  api.getProfile.mockResolvedValue(PROFILE);
  writePortalSession("acme", "live");
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
});

describe("PortalProfilePage", () => {
  it("shows the partner's details; the sign-in email is shown but cannot be edited", async () => {
    renderAt("/p/acme/profile");
    expect(await screen.findByRole("heading", { name: "Your profile" })).toBeInTheDocument();
    expect(api.getProfile).toHaveBeenCalledWith("acme", "live");
    expect(screen.getByLabelText("Your name")).toHaveValue("Jane");
    expect(screen.getByLabelText("Phone (optional)")).toHaveValue("5550100100");
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    expect(screen.getByText("To change it, ask your contact at Acme ISO.")).toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: "Weekly email about my referrals" })).toBeChecked();
  });

  it("saves the trimmed name, a cleared phone and the email choice, then refreshes the top bar", async () => {
    const user = userEvent.setup();
    api.updateProfile.mockResolvedValue({ name: "Jane Smith", phone: null, email: "jane@example.com", weeklyDigest: false });
    renderAt("/p/acme/profile");
    const name = await screen.findByLabelText("Your name");
    await user.clear(name);
    await user.type(name, "  Jane Smith ");
    await user.clear(screen.getByLabelText("Phone (optional)"));
    await user.click(screen.getByRole("checkbox", { name: "Weekly email about my referrals" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(api.updateProfile).toHaveBeenCalledWith("acme", "live", { name: "Jane Smith", phone: null, weeklyDigest: false });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    expect(screen.getByLabelText("Your name")).toHaveValue("Jane Smith");
    await waitFor(() => expect(api.me).toHaveBeenCalledTimes(2));
  });

  it("checks the fields before sending anything", async () => {
    const user = userEvent.setup();
    renderAt("/p/acme/profile");
    await user.clear(await screen.findByLabelText("Your name"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText(PORTAL_PROFILE_MESSAGES.name)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Your name"), "Jane");
    await user.clear(screen.getByLabelText("Phone (optional)"));
    await user.type(screen.getByLabelText("Phone (optional)"), "call me");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText(PORTAL_PROFILE_MESSAGES.phone)).toBeInTheDocument();
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it("points at the field the server refused, and explains the hourly limit", async () => {
    const user = userEvent.setup();
    api.updateProfile
      .mockRejectedValueOnce(new PortalApiError(400, "invalid_body", "phone"))
      .mockRejectedValueOnce(new PortalApiError(429, "rate_limited"));
    renderAt("/p/acme/profile");
    await user.click(await screen.findByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(PORTAL_PROFILE_MESSAGES.phone)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Too many changes in a short time. Try again in an hour.")).toBeInTheDocument();
  });

  it("returns to sign-in when the session is gone", async () => {
    api.getProfile.mockRejectedValue(new PortalApiError(401, "unauthorized"));
    renderAt("/p/acme/profile");
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
  });

  it("offers a retry when the profile can't be loaded", async () => {
    const user = userEvent.setup();
    api.getProfile.mockRejectedValueOnce(new PortalApiError(0, "network_error")).mockResolvedValue(PROFILE);
    renderAt("/p/acme/profile");
    expect(await screen.findByText("We couldn't reach Acme ISO. Check your connection and try again.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Your profile" })).toBeInTheDocument();
  });

  it("is one tap from the top bar", async () => {
    const user = userEvent.setup();
    api.dashboard.mockResolvedValue({ submitted: 0, active: 0, closedWon: 0, conversionRate: null, valueVisible: false });
    api.listReferrals.mockResolvedValue([]);
    renderAt("/p/acme/home");
    await user.click(await screen.findByRole("link", { name: "Profile" }));
    expect(await screen.findByRole("heading", { name: "Your profile" })).toBeInTheDocument();
  });
});
