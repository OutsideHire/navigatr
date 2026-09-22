// Guards the 2026-09-22 blind spot: a failed password reset showed the rep a
// toast and told US nothing. A Supabase auth-email rate limit therefore broke
// resets for a beta customer for a week before anyone noticed, because Sentry
// only ever sees UNHANDLED errors and this one was handled politely.
// The form must REPORT the failure, not merely surface it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const resetPasswordMock = vi.fn();
const captureExceptionMock = vi.fn();

interface AuthStore {
  resetPassword: typeof resetPasswordMock;
}

vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: AuthStore) => unknown) =>
    selector({ resetPassword: resetPasswordMock }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/observability", () => ({
  captureException: (e: unknown, c?: Record<string, unknown>) => captureExceptionMock(e, c),
}));

import { ForgotPasswordForm } from "./ForgotPasswordForm";

function renderForm() {
  return render(
    <MemoryRouter>
      <ForgotPasswordForm />
    </MemoryRouter>,
  );
}

async function submitWith(email: string) {
  await userEvent.type(screen.getByPlaceholderText("you@company.com"), email);
  await userEvent.click(screen.getByRole("button", { name: /send reset link/i }));
}

describe("ForgotPasswordForm reports failures", () => {
  beforeEach(() => {
    resetPasswordMock.mockReset();
    captureExceptionMock.mockReset();
  });

  it("sends a failed reset request to Sentry, tagged with the action", async () => {
    // The exact shape Supabase returns when the project email rate limit is hit.
    const err = new Error("Email rate limit exceeded");
    resetPasswordMock.mockRejectedValueOnce(err);

    renderForm();
    await submitWith("rep@example.com");

    await waitFor(() =>
      expect(captureExceptionMock).toHaveBeenCalledWith(err, {
        action: "auth.reset-password-request",
      }),
    );
  });

  it("reports nothing when the request succeeds", async () => {
    resetPasswordMock.mockResolvedValueOnce(undefined);

    renderForm();
    await submitWith("rep@example.com");

    await waitFor(() => expect(screen.getByText(/check your email/i)).toBeInTheDocument());
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
