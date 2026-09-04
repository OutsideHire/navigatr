/**
 * BrandSettingsCard.test.tsx covers the white-label form behavior: logo UPLOAD
 * (main + optional dark), Remove/Reset clearing, and the absence of the
 * (now-removed) "Powered by navigatr" toggle.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// vi.hoisted so these are available inside the hoisted vi.mock factories.
const { mutateAsync, uploadOrgLogo } = vi.hoisted(() => ({
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  uploadOrgLogo: vi.fn(),
}));

let brandData: {
  productName: string;
  primaryColor: string | null;
  logoUrl: string | null;
  darkLogoUrl: string | null;
  showPoweredBy: boolean;
} | undefined;
let brandError = false;

vi.mock("../useBrand", async (orig) => ({
  ...(await orig<typeof import("../useBrand")>()),
  useBrand: () => ({ data: brandData, isError: brandError }),
}));
vi.mock("../useUpdateBrand", () => ({
  useUpdateBrand: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { org_id: "o-1" } }),
}));
vi.mock("../lib/orgLogoStorage", () => ({
  uploadOrgLogo,
  validateLogoFile: () => null, // accept in tests
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { BrandSettingsCard } from "./BrandSettingsCard";

function pngFile(name = "logo.png") {
  return new File([new Uint8Array(8)], name, { type: "image/png" });
}

beforeEach(() => {
  mutateAsync.mockClear();
  uploadOrgLogo.mockReset().mockResolvedValue("https://cdn.example.com/uploaded.png");
  brandData = { productName: "navigatr", primaryColor: null, logoUrl: null, darkLogoUrl: null, showPoweredBy: true };
  brandError = false;
});

describe("BrandSettingsCard", () => {
  it("does NOT render the editable form (or Save) until current branding loads", () => {
    // Data-loss guard: a blank form on set-directly semantics would wipe the org.
    brandData = undefined;
    render(<BrandSettingsCard />);
    expect(screen.queryByRole("button", { name: /save branding/i })).not.toBeInTheDocument();
    expect(screen.getByText(/loading your branding/i)).toBeInTheDocument();
  });

  it("shows an error (and no form) when branding fails to load", () => {
    brandData = undefined;
    brandError = true;
    render(<BrandSettingsCard />);
    expect(screen.queryByRole("button", { name: /save branding/i })).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't load your current branding/i)).toBeInTheDocument();
  });

  it("has no 'Powered by navigatr' control (the credit can't be toggled off)", () => {
    render(<BrandSettingsCard />);
    expect(screen.queryByText(/powered by/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("uploads a chosen logo and saves its public URL", async () => {
    render(<BrandSettingsCard />);
    fireEvent.change(document.getElementById("brand-logo") as HTMLInputElement, {
      target: { files: [pngFile()] },
    });
    await waitFor(() => expect(uploadOrgLogo).toHaveBeenCalledWith(expect.any(File), "o-1", "logo"));

    fireEvent.click(screen.getByRole("button", { name: /save branding/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({ logoUrl: "https://cdn.example.com/uploaded.png" });
  });

  it("uploads the optional dark-mode logo to the 'dark-logo' variant", async () => {
    render(<BrandSettingsCard />);
    fireEvent.change(document.getElementById("brand-dark-logo") as HTMLInputElement, {
      target: { files: [pngFile("dark.png")] },
    });
    await waitFor(() => expect(uploadOrgLogo).toHaveBeenCalledWith(expect.any(File), "o-1", "dark-logo"));

    fireEvent.click(screen.getByRole("button", { name: /save branding/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({ darkLogoUrl: "https://cdn.example.com/uploaded.png" });
  });

  it("Remove clears an existing logo (saved as null)", async () => {
    brandData = { productName: "Acme", primaryColor: null, logoUrl: "https://cdn/x.png", darkLogoUrl: null, showPoweredBy: true };
    render(<BrandSettingsCard />);
    // The value-variant renders a Remove button once the form hydrates.
    const remove = await screen.findByRole("button", { name: /^remove$/i });
    fireEvent.click(remove);

    fireEvent.click(screen.getByRole("button", { name: /save branding/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0].logoUrl).toBeNull();
  });

  it("Reset to defaults clears color + both logos", async () => {
    brandData = { productName: "Acme", primaryColor: "#2456e6", logoUrl: "https://cdn/x.png", darkLogoUrl: "https://cdn/d.png", showPoweredBy: true };
    render(<BrandSettingsCard />);
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0]).toEqual({
      productName: "navigatr",
      primaryColor: null,
      logoUrl: null,
      darkLogoUrl: null,
    });
  });
});
