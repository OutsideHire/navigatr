// apps/app/src/features/auth/pages/AcceptInvitePage.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AcceptInvitePage } from "./AcceptInvitePage";

const signUpMock = vi.fn();
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: null; signUp: typeof signUpMock }) => unknown) =>
    sel({ user: null, signUp: signUpMock }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/full name/i), "Sarah Lim");
  await user.type(screen.getByLabelText(/work email/i), "sarah@x.com");
  await user.type(screen.getByLabelText(/password/i), "longenoughpw");
  await user.click(screen.getByRole("button", { name: /create my account/i }));
}

beforeEach(() => {
  signUpMock.mockReset();
  signUpMock.mockResolvedValue({ needsEmailConfirmation: false });
});

describe("AcceptInvitePage", () => {
  it("calls signUp with the token from URL", async () => {
    render(
      <MemoryRouter initialEntries={["/accept-invite?token=abc123"]}>
        <AcceptInvitePage />
      </MemoryRouter>,
    );
    await fillAndSubmit();
    expect(signUpMock).toHaveBeenCalledWith("sarah@x.com", "longenoughpw", "Sarah Lim", "abc123");
  });

  it("shows the check-your-email notice when confirmation is required (not a raw callback error)", async () => {
    signUpMock.mockResolvedValue({ needsEmailConfirmation: true });
    render(
      <MemoryRouter initialEntries={["/accept-invite?token=abc123"]}>
        <AcceptInvitePage />
      </MemoryRouter>,
    );
    await fillAndSubmit();
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(screen.getByText(/sarah@x\.com/)).toBeInTheDocument();
    // The signup form is replaced by the notice.
    expect(screen.queryByRole("button", { name: /create my account/i })).not.toBeInTheDocument();
  });
});
