import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let roleLevel = "administrator";
let brandData:
  | { productName: string; primaryColor: string | null; logoUrl: string | null; darkLogoUrl: string | null; showPoweredBy: boolean }
  | undefined;
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { org_id: "o-1", role_level: roleLevel } }),
}));
// Not importing the real module: it pulls in the auth store, which needs a full supabase client.
vi.mock("@/features/branding/useBrand", () => ({
  ORG_BRANDING_QUERY_KEY: (orgId: string | undefined) => ["org-branding", orgId ?? "none"],
  useBrand: () => ({ data: brandData }),
}));

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
  roleLevel = "administrator";
  brandData = {
    productName: "Acme Portal",
    primaryColor: "#0f766e",
    logoUrl: "https://cdn.example/logo.png",
    darkLogoUrl: "https://cdn.example/dark.png",
    showPoweredBy: true,
  };
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

  it("explains that partners accept a changed version at their next sign-in", async () => {
    rpcMock.mockResolvedValueOnce({ data: [SEEDED], error: null });
    renderTab();
    expect(await screen.findByText(/Version 1\. Partners accept the new version at their next sign-in\./)).toBeInTheDocument();
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

  it("keeps the public form switch disabled while the portal is off", async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ ...OFF, public_form_enabled: false }], error: null });
    renderTab();
    const sw = await screen.findByRole("switch", { name: "Public referral form" });
    expect(sw).toBeDisabled();
    expect(sw).not.toBeChecked();
    expect(
      screen.getByText(
        "Anyone with a rep's link or the company link can send you a referral without signing in. Submissions land in Referrals to review.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Turn on the partner portal and save to use the public form.")).toBeInTheDocument();
  });

  it("turns the public form on the moment it is flipped", async () => {
    const user = userEvent.setup();
    rpcMock
      .mockResolvedValueOnce({ data: [{ ...SEEDED, public_form_enabled: false }], error: null })
      .mockResolvedValueOnce({ data: [{ ...SEEDED, public_form_enabled: true }], error: null });
    renderTab();
    await user.click(await screen.findByRole("switch", { name: "Public referral form" }));
    expect(rpcMock).toHaveBeenLastCalledWith("set_public_form_enabled", { p_enabled: true });
    expect(await screen.findByRole("switch", { name: "Public referral form" })).toBeChecked();
    expect(toast.success).toHaveBeenCalledWith("Public referral form is on");
    expect(screen.queryByText("Turn on the partner portal and save to use the public form.")).not.toBeInTheDocument();
  });

  it("explains when the portal has to be on first", async () => {
    const user = userEvent.setup();
    rpcMock
      .mockResolvedValueOnce({ data: [{ ...SEEDED, public_form_enabled: false }], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "portal_disabled" } });
    renderTab();
    await user.click(await screen.findByRole("switch", { name: "Public referral form" }));
    expect(toast.error).toHaveBeenCalledWith("Turn on the partner portal and save first.");
    expect(screen.getByRole("switch", { name: "Public referral form" })).not.toBeChecked();
  });

  it("turns the public form off", async () => {
    const user = userEvent.setup();
    rpcMock
      .mockResolvedValueOnce({ data: [{ ...SEEDED, public_form_enabled: true }], error: null })
      .mockResolvedValueOnce({ data: [{ ...SEEDED, public_form_enabled: false }], error: null });
    renderTab();
    await user.click(await screen.findByRole("switch", { name: "Public referral form" }));
    expect(rpcMock).toHaveBeenLastCalledWith("set_public_form_enabled", { p_enabled: false });
    expect(toast.success).toHaveBeenCalledWith("Public referral form is off");
  });

  it("lets an administrator turn the form off while the portal is off", async () => {
    const user = userEvent.setup();
    rpcMock
      .mockResolvedValueOnce({ data: [{ ...OFF, public_form_enabled: true }], error: null })
      .mockResolvedValueOnce({ data: [{ ...OFF, public_form_enabled: false }], error: null });
    renderTab();
    const sw = await screen.findByRole("switch", { name: "Public referral form" });
    expect(sw).toBeEnabled();
    expect(sw).toBeChecked();
    expect(screen.getByText("The portal is off, so the form is closed. You can still turn this off.")).toBeInTheDocument();
    expect(screen.queryByText("Turn on the partner portal and save to use the public form.")).not.toBeInTheDocument();
    await user.click(sw);
    expect(rpcMock).toHaveBeenLastCalledWith("set_public_form_enabled", { p_enabled: false });
    expect(toast.success).toHaveBeenCalledWith("Public referral form is off");
    expect(await screen.findByRole("switch", { name: "Public referral form" })).toBeDisabled();
    expect(screen.getByText("Turn on the partner portal and save to use the public form.")).toBeInTheDocument();
  });

  it("disables the switch while the change is saving", async () => {
    const user = userEvent.setup();
    let resolveSet: (v: unknown) => void = () => {};
    rpcMock
      .mockResolvedValueOnce({ data: [{ ...SEEDED, public_form_enabled: false }], error: null })
      .mockReturnValueOnce(new Promise((r) => { resolveSet = r; }));
    renderTab();
    await user.click(await screen.findByRole("switch", { name: "Public referral form" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Public referral form" })).toBeDisabled());
    resolveSet({ data: [{ ...SEEDED, public_form_enabled: true }], error: null });
    await waitFor(() => expect(screen.getByRole("switch", { name: "Public referral form" })).toBeEnabled());
  });

  it("shows the generic message for any other failure", async () => {
    const user = userEvent.setup();
    rpcMock
      .mockResolvedValueOnce({ data: [{ ...SEEDED, public_form_enabled: false }], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    renderTab();
    await user.click(await screen.findByRole("switch", { name: "Public referral form" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't change the public referral form. Try again."));
  });
  describe("Powered by navigatr switch (FR-PORT-82)", () => {
    const LABEL = "Show 'Powered by navigatr' to partners";

    it("is shown to administrators, on by default", async () => {
      rpcMock.mockResolvedValueOnce({ data: [SEEDED], error: null });
      renderTab();
      expect(await screen.findByRole("switch", { name: LABEL })).toBeChecked();
    });

    it("is hidden from anyone who is not an administrator", async () => {
      roleLevel = "sales_manager";
      rpcMock.mockResolvedValueOnce({ data: [SEEDED], error: null });
      renderTab();
      await screen.findByRole("switch", { name: "Turn on the partner portal" });
      expect(screen.queryByRole("switch", { name: LABEL })).not.toBeInTheDocument();
    });

    it("reflects a saved off state", async () => {
      brandData = { ...brandData!, showPoweredBy: false };
      rpcMock.mockResolvedValueOnce({ data: [SEEDED], error: null });
      renderTab();
      expect(await screen.findByRole("switch", { name: LABEL })).not.toBeChecked();
    });

    it("sends the existing logo, color and name with the flipped value, so nothing is cleared", async () => {
      const user = userEvent.setup();
      rpcMock
        .mockResolvedValueOnce({ data: [SEEDED], error: null })
        .mockResolvedValueOnce({
          data: {
            product_name: "Acme Portal",
            primary_color: "#0f766e",
            logo_url: "https://cdn.example/logo.png",
            dark_logo_url: "https://cdn.example/dark.png",
            show_powered_by: false,
          },
          error: null,
        });
      renderTab();
      await user.click(await screen.findByRole("switch", { name: LABEL }));
      expect(rpcMock).toHaveBeenLastCalledWith("update_org_branding", {
        p_product_name: "Acme Portal",
        p_primary_color: "#0f766e",
        p_logo_url: "https://cdn.example/logo.png",
        p_dark_logo_url: "https://cdn.example/dark.png",
        p_show_powered_by: false,
      });
      await waitFor(() => expect(toast.success).toHaveBeenCalled());
    });

    it("says so when the change fails", async () => {
      const user = userEvent.setup();
      rpcMock.mockResolvedValueOnce({ data: [SEEDED], error: null }).mockResolvedValueOnce({ data: null, error: { message: "boom" } });
      renderTab();
      await user.click(await screen.findByRole("switch", { name: LABEL }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't change this setting. Try again."));
    });

    it("is not offered until the current branding has loaded (a blank save would clear it)", async () => {
      brandData = undefined;
      rpcMock.mockResolvedValueOnce({ data: [SEEDED], error: null });
      renderTab();
      await screen.findByRole("switch", { name: "Turn on the partner portal" });
      expect(screen.queryByRole("switch", { name: LABEL })).not.toBeInTheDocument();
    });
  });
});
