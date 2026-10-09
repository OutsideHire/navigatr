import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { PartnerPortalTab } from "./PartnerPortalTab";

const OFF = {
  enabled: false,
  terms_text: null,
  terms_version: 0,
  consent_text: null,
  consent_version: 0,
  value_visibility: false,
  slug: "acme",
  org_name: "Acme ISO",
};
const SEEDED = {
  ...OFF,
  enabled: true,
  terms_text:
    "By using this portal you agree to share business referrals with Acme ISO and to only submit contact details you have permission to share. Acme ISO may contact the businesses you refer.",
  terms_version: 1,
  consent_text: "I have permission to share this business's contact details.",
  consent_version: 1,
};

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PartnerPortalTab />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpcMock.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("PartnerPortalTab", () => {
  it("loads the settings and shows the portal address", async () => {
    rpcMock.mockResolvedValueOnce({ data: [OFF], error: null });
    renderTab();
    expect(await screen.findByRole("switch", { name: "Turn on the partner portal" })).not.toBeChecked();
    expect(rpcMock).toHaveBeenCalledWith("get_portal_settings");
    expect(screen.getByLabelText("Portal address")).toHaveValue(`${window.location.origin}/p/acme`);
  });

  it("turns the portal on and shows the starting terms with their version", async () => {
    const user = userEvent.setup();
    rpcMock.mockResolvedValueOnce({ data: [OFF], error: null }).mockResolvedValueOnce({ data: [SEEDED], error: null });
    renderTab();
    await user.click(await screen.findByRole("switch", { name: "Turn on the partner portal" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(rpcMock).toHaveBeenLastCalledWith("update_portal_settings", {
      p_enabled: true,
      p_terms_text: "",
      p_consent_text: "",
      p_value_visibility: false,
    });
    expect(await screen.findByDisplayValue(SEEDED.terms_text)).toBeInTheDocument();
    expect(screen.getByText(/Version 1\./)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Turn on the partner portal" })).toBeChecked();
    expect(toast.success).toHaveBeenCalledWith("Portal settings saved");
  });

  it("saves edited terms and the value toggle, and shows the new version", async () => {
    const user = userEvent.setup();
    rpcMock
      .mockResolvedValueOnce({ data: [SEEDED], error: null })
      .mockResolvedValueOnce({ data: [{ ...SEEDED, terms_text: "New terms.", terms_version: 2, value_visibility: true }], error: null });
    renderTab();
    const terms = await screen.findByLabelText("Partner terms");
    await user.clear(terms);
    await user.type(terms, "New terms.");
    await user.click(screen.getByRole("switch", { name: "Show closed-won value to partners" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(rpcMock).toHaveBeenLastCalledWith("update_portal_settings", {
      p_enabled: true,
      p_terms_text: "New terms.",
      p_consent_text: SEEDED.consent_text,
      p_value_visibility: true,
    });
    expect(await screen.findByText(/Version 2\./)).toBeInTheDocument();
  });

  it("copies the portal address", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    rpcMock.mockResolvedValueOnce({ data: [SEEDED], error: null });
    renderTab();
    await user.click(await screen.findByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/p/acme`);
  });

  it("says so when saving fails", async () => {
    const user = userEvent.setup();
    rpcMock
      .mockResolvedValueOnce({ data: [SEEDED], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "not_authorized" } });
    renderTab();
    await user.click(await screen.findByRole("button", { name: "Save" }));
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the portal settings. Try again.");
  });

  it("explains that only partners who join later accept a changed version", async () => {
    rpcMock.mockResolvedValueOnce({ data: [SEEDED], error: null });
    renderTab();
    expect(await screen.findByText(/Version 1\. Partners who join after a change accept the new version\./)).toBeInTheDocument();
    expect(screen.queryByText(/accept again/i)).not.toBeInTheDocument();
  });

  it("shows the kept text after saving blank terms and consent", async () => {
    const user = userEvent.setup();
    rpcMock.mockResolvedValueOnce({ data: [SEEDED], error: null }).mockResolvedValueOnce({ data: [SEEDED], error: null });
    renderTab();
    const terms = await screen.findByLabelText("Partner terms");
    await user.clear(terms);
    await user.clear(screen.getByLabelText("Consent line"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(rpcMock).toHaveBeenLastCalledWith("update_portal_settings", {
      p_enabled: true,
      p_terms_text: "",
      p_consent_text: "",
      p_value_visibility: false,
    });
    expect(await screen.findByDisplayValue(SEEDED.terms_text)).toBeInTheDocument();
    expect(screen.getByLabelText("Consent line")).toHaveValue(SEEDED.consent_text);
    expect(toast.success).toHaveBeenCalledWith("Portal settings saved");
  });
});
