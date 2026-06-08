// Tests the magic-link path on /login: mode toggle, password field
// disappears, success-card replaces the form after a successful send,
// and signInWithMagicLink gets the right email. Doesn't try to exercise
// the password path — that's covered by Supabase + the auth store
// and would just be testing react-hook-form here.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { LoginForm } from "./LoginForm";

const signInWithEmailMock = vi.fn();
const signInWithMagicLinkMock = vi.fn();
const verifyMagicLinkCodeMock = vi.fn();
const signInWithGoogleMock = vi.fn();

vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: AuthStore) => unknown) =>
    selector({
      signInWithEmail: signInWithEmailMock,
      signInWithMagicLink: signInWithMagicLinkMock,
      verifyMagicLinkCode: verifyMagicLinkCodeMock,
      signInWithGoogle: signInWithGoogleMock,
    }),
}));

// OAuthButtons + OrDivider render real UI but their submit handlers
// pull useAuth() themselves — the mock above gives them what they need.
// No further mocking required.

interface AuthStore {
  signInWithEmail: typeof signInWithEmailMock;
  signInWithMagicLink: typeof signInWithMagicLinkMock;
  verifyMagicLinkCode: typeof verifyMagicLinkCodeMock;
  signInWithGoogle: typeof signInWithGoogleMock;
}

function renderForm() {
  return render(
    <MemoryRouter>
      <LoginForm />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  signInWithEmailMock.mockReset();
  signInWithMagicLinkMock.mockReset();
  verifyMagicLinkCodeMock.mockReset();
});

describe("LoginForm / magic link path", () => {
  it("renders password mode by default", () => {
    renderForm();
    expect(screen.getByLabelText(/work email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in without a password/i })).toBeInTheDocument();
  });

  it("offers Google SSO but not the dead Microsoft/azure button", () => {
    // Azure provider isn't enabled in Supabase — the Microsoft button was a
    // dead path (400 validation_failed). It's removed; Google stays.
    renderForm();
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /continue with microsoft/i })).not.toBeInTheDocument();
  });

  it("toggling to magic-link mode hides the password field", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: /sign in without a password/i }));

    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/forgot password\?/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /email me a sign-in code/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /use a password instead/i })).toBeInTheDocument();
  });

  it("submitting the magic-link form calls signInWithMagicLink with the email", async () => {
    signInWithMagicLinkMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: /sign in without a password/i }));
    await user.type(screen.getByLabelText(/work email/i), "ryan@navigatr.app");
    await user.click(screen.getByRole("button", { name: /email me a sign-in code/i }));

    await waitFor(() => {
      expect(signInWithMagicLinkMock).toHaveBeenCalledWith("ryan@navigatr.app");
    });
    expect(signInWithEmailMock).not.toHaveBeenCalled();
  });

  it("after sending, shows the code-entry form (not a clickable-link reminder)", async () => {
    signInWithMagicLinkMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: /sign in without a password/i }));
    await user.type(screen.getByLabelText(/work email/i), "ryan@navigatr.app");
    await user.click(screen.getByRole("button", { name: /email me a sign-in code/i }));

    await screen.findByText(/check your inbox/i);
    expect(screen.getByText(/ryan@navigatr\.app/)).toBeInTheDocument();
    // Email form is gone — only the OTP entry is rendered now.
    expect(screen.queryByLabelText(/work email/i)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("12345678")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send another/i })).toBeInTheDocument();
  });

  it("typing a code and submitting calls verifyMagicLinkCode with the email + code", async () => {
    signInWithMagicLinkMock.mockResolvedValueOnce(undefined);
    verifyMagicLinkCodeMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderForm();

    // Get into the code-entry state
    await user.click(screen.getByRole("button", { name: /sign in without a password/i }));
    await user.type(screen.getByLabelText(/work email/i), "ryan@navigatr.app");
    await user.click(screen.getByRole("button", { name: /email me a sign-in code/i }));
    await screen.findByPlaceholderText("12345678");

    // Type an 8-digit code (the length your Supabase project uses)
    await user.type(screen.getByPlaceholderText("12345678"), "61703862");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(verifyMagicLinkCodeMock).toHaveBeenCalledWith("ryan@navigatr.app", "61703862");
    });
  });

  it("non-numeric input is filtered out; >10 digits are truncated to 10", async () => {
    signInWithMagicLinkMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: /sign in without a password/i }));
    await user.type(screen.getByLabelText(/work email/i), "ryan@navigatr.app");
    await user.click(screen.getByRole("button", { name: /email me a sign-in code/i }));
    const input = await screen.findByPlaceholderText("12345678");

    // User pastes a long alphanumeric string
    await user.type(input, "1a2b3c4d5e6f7g8h9i0jKlMn");
    // First 10 digits survive — Supabase's max OTP length
    expect((input as HTMLInputElement).value).toBe("1234567890");
  });

  it("rejects an invalid email before calling the store", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: /sign in without a password/i }));
    await user.type(screen.getByLabelText(/work email/i), "not-an-email");
    await user.click(screen.getByRole("button", { name: /email me a sign-in code/i }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(signInWithMagicLinkMock).not.toHaveBeenCalled();
  });
});
