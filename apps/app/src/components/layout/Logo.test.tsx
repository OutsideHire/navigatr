/**
 * Logo.test.tsx covers the white-label logo variant selection: which src renders in
 * light vs dark mode, and the light-backing fallback for a main logo shown in
 * dark mode (so a dark logo can't vanish on a dark top bar).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

let resolvedTheme: "light" | "dark" = "light";
vi.mock("@/stores/theme", () => ({
  useTheme: (sel: (s: { resolvedTheme: string }) => unknown) => sel({ resolvedTheme }),
}));
vi.mock("./LogoMark", () => ({ LogoMark: () => <span data-testid="logo-mark" /> }));

import { Logo } from "./Logo";

beforeEach(() => {
  resolvedTheme = "light";
});

describe("Logo white-label variants", () => {
  it("renders the compass mark when no tenant logo is set", () => {
    const { getByTestId, container } = render(<Logo />);
    expect(getByTestId("logo-mark")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("light mode: shows the main logo with no white backing", () => {
    const { container } = render(<Logo logoSrc="https://x/light.png" logoSrcDark="https://x/dark.png" />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://x/light.png");
    expect(img.className).not.toContain("bg-white");
  });

  it("dark mode with a dark logo: shows the dark logo seamlessly (no backing)", () => {
    resolvedTheme = "dark";
    const { container } = render(<Logo logoSrc="https://x/light.png" logoSrcDark="https://x/dark.png" />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://x/dark.png");
    expect(img.className).not.toContain("bg-white");
  });

  it("dark mode without a dark logo: falls back to the main logo on a white backing", () => {
    resolvedTheme = "dark";
    const { container } = render(<Logo logoSrc="https://x/light.png" />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://x/light.png");
    expect(img.className).toContain("bg-white");
  });
});
