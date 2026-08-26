import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OAuthButtons } from "./OAuthButtons";

vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { signInWithGoogle: () => void }) => unknown) =>
    sel({ signInWithGoogle: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function renderButtons(props: Partial<React.ComponentProps<typeof OAuthButtons>> = {}) {
  render(
    <MemoryRouter>
      <OAuthButtons {...props} />
    </MemoryRouter>,
  );
}

describe("OAuthButtons consent note", () => {
  it("shows the passive Terms/Privacy consent line when consentNote is set (login edge)", () => {
    renderButtons({ consentNote: true });
    expect(screen.getByText(/by continuing, you agree/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /terms of service/i })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: /privacy policy/i })).toHaveAttribute("href", "/privacy");
  });

  it("omits the consent line by default (signup gates via its own checkbox)", () => {
    renderButtons();
    expect(screen.queryByText(/by continuing, you agree/i)).not.toBeInTheDocument();
  });
});
