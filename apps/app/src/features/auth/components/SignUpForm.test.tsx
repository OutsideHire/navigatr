import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SignUpForm } from "./SignUpForm";

const { signUpMock, navigateMock, toastErrorMock } = vi.hoisted(() => ({
  signUpMock: vi.fn(),
  navigateMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { signUp: typeof signUpMock }) => unknown) => sel({ signUp: signUpMock }),
}));
// The OAuth buttons pull in their own auth/supabase wiring; stub them with a
// disabled-reflecting placeholder so we can assert the consent gate applies to
// the Google path too, without dragging in supabase.
vi.mock("./OAuthButtons", () => ({
  OAuthButtons: ({ disabled }: { disabled?: boolean }) => (
    <button type="button" disabled={disabled}>
      Continue with Google
    </button>
  ),
  OrDivider: () => null,
}));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock("sonner", () => ({ toast: { error: toastErrorMock, success: vi.fn() } }));

async function fillAndSubmit(email = "new@company.com") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/full name/i), "Jamie Rivera");
  await user.type(screen.getByLabelText(/work email/i), email);
  await user.type(screen.getByLabelText(/password/i), "longenoughpw");
  await user.click(screen.getByRole("checkbox", { name: /i agree to the terms/i }));
  await user.click(screen.getByRole("button", { name: /create account/i }));
}

function renderForm() {
  render(
    <MemoryRouter>
      <SignUpForm />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  signUpMock.mockReset();
  navigateMock.mockReset();
  toastErrorMock.mockReset();
});

describe("SignUpForm submit branches", () => {
  it("routes to /auth/callback when confirmation is off (session already created)", async () => {
    signUpMock.mockResolvedValue({ needsEmailConfirmation: false, alreadyRegistered: false });
    renderForm();
    await fillAndSubmit();
    expect(navigateMock).toHaveBeenCalledWith("/auth/callback");
  });

  it("shows the check-your-email notice when confirmation is required", async () => {
    signUpMock.mockResolvedValue({ needsEmailConfirmation: true, alreadyRegistered: false });
    renderForm();
    await fillAndSubmit("brand.new@company.com");
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(screen.getByText(/brand\.new@company\.com/)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalledWith("/auth/callback");
  });

  it("sends an already-registered email to sign in instead of stranding on check-your-email", async () => {
    signUpMock.mockResolvedValue({ needsEmailConfirmation: false, alreadyRegistered: true });
    renderForm();
    await fillAndSubmit("existing@company.com");
    expect(navigateMock).toHaveBeenCalledWith("/login");
    expect(toastErrorMock).toHaveBeenCalled();
    expect(screen.queryByText(/check your email/i)).not.toBeInTheDocument();
  });

  it("blocks account creation until Terms are agreed", async () => {
    signUpMock.mockResolvedValue({ needsEmailConfirmation: false, alreadyRegistered: false });
    renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/full name/i), "Jamie Rivera");
    await user.type(screen.getByLabelText(/work email/i), "new@company.com");
    await user.type(screen.getByLabelText(/password/i), "longenoughpw");
    // Submit WITHOUT checking the consent box.
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(signUpMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/please agree to the terms/i)).toBeInTheDocument();
  });

  it("keeps Continue with Google disabled until Terms are agreed", async () => {
    renderForm();
    const google = screen.getByRole("button", { name: /continue with google/i });
    expect(google).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /i agree to the terms/i }));
    expect(google).toBeEnabled();
  });
});
