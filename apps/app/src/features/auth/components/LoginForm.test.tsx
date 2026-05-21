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

vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: AuthStore) => unknown) =>
    selector({
      signInWithEmail: signInWithEmailMock,
      signInWithMagicLink: signInWithMagicLinkMock,
    }),
}));

// OAuthButtons + OrDivider render real UI but their submit handlers
// pull useAuth() themselves — the mock above gives them what they need.
// No further mocking required.

interface AuthStore {
  signInWithEmail: typeof signInWithEmailMock;
  signInWithMagicLink: typeof signInWithMagicLinkMock;
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
});

describe("LoginForm / magic link path", () => {
  it("renders password mode by default", () => {
    renderForm();
    expect(screen.getByLabelText(/work email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in without a password/i })).toBeInTheDocument();
  });

  it("toggling to magic-link mode hides the password field", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: /sign in without a password/i }));

    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/forgot password\?/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /email me a sign-in link/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /use a password instead/i })).toBeInTheDocument();
  });

  it("submitting the magic-link form calls signInWithMagicLink with the email", async () => {
    signInWithMagicLinkMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: /sign in without a password/i }));
    await user.type(screen.getByLabelText(/work email/i), "ryan@navigatr.app");
    await user.click(screen.getByRole("button", { name: /email me a sign-in link/i }));

    await waitFor(() => {
      expect(signInWithMagicLinkMock).toHaveBeenCalledWith("ryan@navigatr.app");
    });
    expect(signInWithEmailMock).not.toHaveBeenCalled();
  });

  it("shows the 'check your inbox' confirmation after a successful send", async () => {
    signInWithMagicLinkMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: /sign in without a password/i }));
    await user.type(screen.getByLabelText(/work email/i), "ryan@navigatr.app");
    await user.click(screen.getByRole("button", { name: /email me a sign-in link/i }));

    await screen.findByText(/check your inbox/i);
    expect(screen.getByText(/ryan@navigatr\.app/)).toBeInTheDocument();
    // Form is gone — only the confirmation card is rendered now.
    expect(screen.queryByLabelText(/work email/i)).not.toBeInTheDocument();
    // "Send another" path is one click away.
    expect(screen.getByRole("button", { name: /send another/i })).toBeInTheDocument();
  });

  it("rejects an invalid email before calling the store", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: /sign in without a password/i }));
    await user.type(screen.getByLabelText(/work email/i), "not-an-email");
    await user.click(screen.getByRole("button", { name: /email me a sign-in link/i }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(signInWithMagicLinkMock).not.toHaveBeenCalled();
  });
});
