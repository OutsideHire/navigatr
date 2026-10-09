import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PortalBrandProvider } from "./PortalBrandProvider";
import { deriveBrandVars } from "@/features/branding/colorShades";
import { useTheme } from "@/stores/theme";
import type { PortalBrand } from "./lib/portalApi";

const BRAND: PortalBrand = {
  orgName: "Acme ISO",
  productName: "navigatr",
  primaryColor: "#0f766e",
  logoUrl: null,
  darkLogoUrl: null,
};

describe("PortalBrandProvider", () => {
  it("applies the tenant color and tab title, and resets both on unmount", () => {
    document.title = "navigatr";
    document.documentElement.style.setProperty("--color-brand-primary", "#123456");
    const { unmount, getByText } = render(
      <PortalBrandProvider brand={BRAND}>
        <p>child</p>
      </PortalBrandProvider>,
    );
    expect(getByText("child")).toBeInTheDocument();
    const isDark = useTheme.getState().resolvedTheme === "dark";
    const expected = deriveBrandVars("#0f766e", isDark);
    const root = document.documentElement;
    expect(expected?.primary).not.toBe("#123456");
    expect(root.style.getPropertyValue("--color-brand-primary")).toBe(expected?.primary);
    expect(root.style.getPropertyValue("--color-brand-primary-foreground")).toBe(expected?.foreground);
    expect(document.title).toBe("Acme ISO");

    unmount();
    expect(root.style.getPropertyValue("--color-brand-primary")).toBe("");
    expect(document.title).toBe("navigatr");
  });

  it("keeps the design-system defaults when the tenant has no color", () => {
    render(
      <PortalBrandProvider brand={{ ...BRAND, primaryColor: null }}>
        <p>child</p>
      </PortalBrandProvider>,
    );
    expect(document.documentElement.style.getPropertyValue("--color-brand-primary")).toBe("");
  });
});
