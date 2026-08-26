// apps/app/src/features/auth/pages/AcceptInvitePage.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AcceptInvitePage } from "./AcceptInvitePage";

const { signUpMock, navigateMock, toastErrorMock, rpcMock } = vi.hoisted(() => ({
  signUpMock: vi.fn(),
  navigateMock: vi.fn(),
  toastErrorMock: vi.fn(),
  rpcMock: vi.fn(),
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: null; signUp: typeof signUpMock }) => unknown) =>
    sel({ user: null, signUp: signUpMock }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock("sonner", () => ({ toast: { error: toastErrorMock, success: vi.fn() } }));

const INVITE = {
  org_name: "Acme ISO",
  role_level: "sales_professional",
  inviter_name: "Ivy Admin",
  invitee_email: "sarah@x.com",
  invitee_full_name: "Sarah Lim",
};

function renderAt(token = "abc123") {
  render(
    <MemoryRouter initialEntries={[`/accept-invite?token=${token}`]}>
      <AcceptInvitePage />
    </MemoryRouter>,
  );
}

// email + name are pre-filled from the invite; just set a password + submit.
async function submitPassword() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/password/i), "longenoughpw");
  await user.click(screen.getByRole("button", { name: /create my account/i }));
}

beforeEach(() => {
  signUpMock.mockReset();
  navigateMock.mockReset();
  toastErrorMock.mockReset();
  rpcMock.mockReset();
  signUpMock.mockResolvedValue({ needsEmailConfirmation: false, alreadyRegistered: false });
  // Default: a live invite. Individual tests override for the invalid case.
  rpcMock.mockImplementation((fn: string) =>
    fn === "peek_invite"
      ? Promise.resolve({ data: [INVITE], error: null })
      : Promise.resolve({ data: null, error: null }),
  );
});

describe("AcceptInvitePage", () => {
  it("shows who invited them / org / role and signs up with the invited email", async () => {
    renderAt("abc123");
    expect(await screen.findByText(/Ivy Admin/)).toBeInTheDocument();
    expect(screen.getByText(/Acme ISO/)).toBeInTheDocument();
    expect(screen.getByText(/Sales Professional/)).toBeInTheDocument();

    await submitPassword();
    expect(signUpMock).toHaveBeenCalledWith("sarah@x.com", "longenoughpw", "Sarah Lim", "abc123");
    expect(navigateMock).toHaveBeenCalledWith("/auth/callback");
  });

  it("shows the check-your-email notice when confirmation is required", async () => {
    signUpMock.mockResolvedValue({ needsEmailConfirmation: true, alreadyRegistered: false });
    renderAt("abc123");
    await submitPassword();
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create my account/i })).not.toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalledWith("/auth/callback");
  });

  it("sends an already-registered email to sign in", async () => {
    signUpMock.mockResolvedValue({ needsEmailConfirmation: false, alreadyRegistered: true });
    renderAt("abc123");
    await submitPassword();
    expect(navigateMock).toHaveBeenCalledWith("/login");
    expect(toastErrorMock).toHaveBeenCalled();
  });

  it("shows an invalid-invite message (no form) when the token doesn't resolve", async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === "peek_invite"
        ? Promise.resolve({ data: [], error: null })
        : Promise.resolve({ data: null, error: null }),
    );
    renderAt("badtoken");
    expect(await screen.findByText(/isn't valid/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create my account/i })).not.toBeInTheDocument();
  });
});
