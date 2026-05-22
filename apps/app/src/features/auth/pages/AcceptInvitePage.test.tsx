// apps/app/src/features/auth/pages/AcceptInvitePage.test.tsx
import { describe, it, expect, vi } from "vitest";
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

describe("AcceptInvitePage", () => {
  it("calls signUp with the token from URL", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/accept-invite?token=abc123"]}>
        <AcceptInvitePage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText(/full name/i), "Sarah Lim");
    await user.type(screen.getByLabelText(/work email/i), "sarah@x.com");
    await user.type(screen.getByLabelText(/password/i), "longenoughpw");
    await user.click(screen.getByRole("button", { name: /create my account/i }));
    expect(signUpMock).toHaveBeenCalledWith("sarah@x.com", "longenoughpw", "Sarah Lim", "abc123");
  });
});
