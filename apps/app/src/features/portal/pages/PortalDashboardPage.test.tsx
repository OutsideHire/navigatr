import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
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
}));

vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: api };
});

const csv = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("../lib/portalCsv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalCsv")>();
  return { ...actual, downloadCsv: csv.download };
});

import { PortalRoot } from "./PortalRoot";
import { PortalApiError } from "../lib/portalApi";
import { readPortalSession, writePortalSession } from "../lib/portalSession";

const BRAND = { orgName: "Acme ISO", productName: "navigatr", primaryColor: null, logoUrl: null, darkLogoUrl: null };
const ME = { partnerName: "Jane", email: "jane@example.com", orgName: "Acme ISO" };
const STATS = { submitted: 4, active: 2, closedWon: 1, conversionRate: 0.5, valueVisible: false };
const ROWS = [
  {
    id: "r-1",
    ref: "REF-AAAA0001",
    companyName: "Fresh Bakery",
    label: "In Progress",
    submittedAt: "2026-10-01T12:00:00Z",
    lastActivityAt: "2026-10-05T12:00:00Z",
  },
  {
    id: "r-2",
    ref: "REF-AAAA0002",
    companyName: "Corner Cafe",
    label: "Received",
    submittedAt: "2026-10-02T12:00:00Z",
    lastActivityAt: "2026-10-02T12:00:00Z",
  },
];

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

function renderHome(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/p/acme/home"]}>
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
  csv.download.mockReset();
  api.brand.mockResolvedValue(BRAND);
  api.me.mockResolvedValue(ME);
  api.dashboard.mockResolvedValue(STATS);
  api.listReferrals.mockResolvedValue(ROWS);
  writePortalSession("acme", "live");
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", { value: origLocalStorage, writable: true, configurable: true });
});

describe("PortalDashboardPage", () => {
  it("shows the tiles and the partner's referrals with partner labels", async () => {
    renderHome();
    expect(await screen.findByRole("heading", { name: "Your referrals" })).toBeInTheDocument();
    expect(screen.getByText("Signed in as Jane at Acme ISO")).toBeInTheDocument();
    expect(api.dashboard).toHaveBeenCalledWith("acme", "live", "all");
    expect(api.listReferrals).toHaveBeenCalledWith("acme", "live", "all");

    const tiles = await screen.findByRole("region", { name: "Summary" });
    expect(within(tiles).getByText("Submitted").nextSibling).toHaveTextContent("4");
    expect(within(tiles).getByText("Active").nextSibling).toHaveTextContent("2");
    expect(within(tiles).getByText("Closed Won").nextSibling).toHaveTextContent("1");
    expect(within(tiles).getByText("Conversion rate").nextSibling).toHaveTextContent("50%");
    expect(within(tiles).queryByText("Total value")).toBeNull();

    const row = await screen.findByRole("link", { name: /Fresh Bakery/ });
    expect(row).toHaveAttribute("href", "/p/acme/r/r-1");
    expect(within(row).getByText("In Progress")).toBeInTheDocument();
    expect(within(row).getByText("REF-AAAA0001 · Updated Oct 5, 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Corner Cafe/ })).toHaveTextContent("Received");
  });

  it("shows closed-won value only when the ISO allows it", async () => {
    api.dashboard.mockResolvedValue({ ...STATS, valueVisible: true, totalValueCents: 500000 });
    renderHome();
    const tiles = await screen.findByRole("region", { name: "Summary" });
    expect(await within(tiles).findByText("Total value")).toBeInTheDocument();
    expect(within(tiles).getByText("$5,000")).toBeInTheDocument();
  });

  it("says when nothing has closed yet and when there are no referrals", async () => {
    api.dashboard.mockResolvedValue({ submitted: 0, active: 0, closedWon: 0, conversionRate: null, valueVisible: false });
    api.listReferrals.mockResolvedValue([]);
    renderHome();
    expect(await screen.findByText("No closed referrals yet")).toBeInTheDocument();
    expect(screen.getByText("Nothing here yet. Send Acme ISO a business and follow it here.")).toBeInTheDocument();
  });

  it("switches the time period", async () => {
    const user = userEvent.setup();
    renderHome();
    await screen.findByRole("link", { name: /Fresh Bakery/ });
    expect(screen.getByRole("button", { name: "All time" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "30 days" }));
    expect(screen.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
    expect(api.dashboard).toHaveBeenLastCalledWith("acme", "live", "30d");
    expect(api.listReferrals).toHaveBeenLastCalledWith("acme", "live", "30d");
  });

  it("polls the tiles and the list every 30 seconds", async () => {
    const client = renderHome();
    await screen.findByRole("link", { name: /Fresh Bakery/ });
    for (const key of [
      ["portal", "data", "acme", "live", "dashboard", "all"],
      ["portal", "data", "acme", "live", "list", "all"],
    ]) {
      const query = client.getQueryCache().find({ queryKey: key, exact: true });
      expect(query?.observers[0]?.options.refetchInterval).toBe(30_000);
    }
  });

  it("returns to sign-in and forgets the session when the session is gone", async () => {
    api.dashboard.mockRejectedValue(new PortalApiError(401, "unauthorized"));
    renderHome();
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(readPortalSession("acme")).toBeNull();
  });

  it("offers a retry when the referrals can't be loaded", async () => {
    const user = userEvent.setup();
    api.listReferrals.mockRejectedValueOnce(new PortalApiError(0, "network_error")).mockResolvedValue(ROWS);
    renderHome();
    expect(await screen.findByText("We couldn't reach Acme ISO. Check your connection and try again.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /Fresh Bakery/ })).toBeInTheDocument();
  });

  it("signs out from the top bar and drops the cached partner data", async () => {
    const user = userEvent.setup();
    api.signOut.mockResolvedValue(undefined);
    const client = renderHome();
    await screen.findByRole("link", { name: /Fresh Bakery/ });
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
    expect(client.getQueryCache().findAll({ queryKey: ["portal", "data", "acme"] })).toHaveLength(0);
  });
  it("keeps showing the last data when a later poll fails", async () => {
    api.dashboard.mockResolvedValueOnce(STATS).mockRejectedValue(new PortalApiError(0, "network_error"));
    const client = renderHome();
    await screen.findByRole("link", { name: /Fresh Bakery/ });
    await act(async () => {
      await client.refetchQueries({ queryKey: ["portal", "data", "acme"] });
    });
    expect(api.dashboard).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("link", { name: /Fresh Bakery/ })).toBeInTheDocument();
    expect(screen.queryByText(/We couldn't reach/)).toBeNull();
  });

  it("downloads the partner's referrals for the chosen period as a CSV", async () => {
    const user = userEvent.setup();
    api.exportReferrals.mockResolvedValue({
      valueVisible: false,
      rows: [
        {
          ref: "REF-AAAA0001",
          companyName: "Fresh Bakery",
          label: "In Progress",
          submittedAt: "2026-10-01T12:00:00Z",
          lastActivityAt: "2026-10-05T12:00:00Z",
          closedWonValueCents: null,
        },
      ],
    });
    renderHome();
    await screen.findByRole("link", { name: /Fresh Bakery/ });
    await user.click(screen.getByRole("button", { name: "30 days" }));
    await user.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(api.exportReferrals).toHaveBeenCalledWith("acme", "live", "30d");
    expect(csv.download).toHaveBeenCalledTimes(1);
    const [filename, content] = csv.download.mock.calls[0] as [string, string];
    expect(filename).toMatch(/^acme-referrals-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(content).toBe(
      "Reference,Business,Status,Sent,Last update\r\nREF-AAAA0001,Fresh Bakery,In Progress,2026-10-01,2026-10-05\r\n",
    );
  });

  it("offers no download when there are no referrals", async () => {
    api.listReferrals.mockResolvedValue([]);
    renderHome();
    await screen.findByText("Nothing here yet. Send Acme ISO a business and follow it here.");
    expect(screen.queryByRole("button", { name: "Download CSV" })).toBeNull();
  });

  it("says when the file could not be built, and keeps the list", async () => {
    const user = userEvent.setup();
    api.exportReferrals.mockRejectedValue(new PortalApiError(0, "network_error"));
    renderHome();
    await user.click(await screen.findByRole("button", { name: "Download CSV" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't reach Acme ISO. Check your connection and try again.");
    expect(csv.download).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Fresh Bakery/ })).toBeInTheDocument();
  });

  it("returns to sign-in when the session is gone during the export", async () => {
    const user = userEvent.setup();
    api.exportReferrals.mockRejectedValue(new PortalApiError(401, "unauthorized"));
    renderHome();
    await user.click(await screen.findByRole("button", { name: "Download CSV" }));
    expect(await screen.findByRole("heading", { name: "Sign in to Acme ISO" })).toBeInTheDocument();
  });
});
