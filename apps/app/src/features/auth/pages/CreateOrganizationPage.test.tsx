import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { CreateOrganizationPage } from "./CreateOrganizationPage";

const { navigateMock, mutateAsyncMock, toastSuccess, toastError } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  mutateAsyncMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("../useCreateOrganization", () => ({
  useCreateOrganization: () => ({ mutateAsync: mutateAsyncMock }),
}));
// Authed, not yet in an org -> the form renders (no redirect).
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: unknown; loading: boolean }) => unknown) =>
    selector({ user: { id: "u1" }, loading: false }),
}));
vi.mock("../useProfile", () => ({
  useProfile: () => ({ data: null, isLoading: false }),
}));

beforeEach(() => {
  navigateMock.mockReset();
  mutateAsyncMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("CreateOrganizationPage invite code", () => {
  it("surfaces the invite code as a persistent, copyable toast (not an 8s flash)", async () => {
    mutateAsyncMock.mockResolvedValue({ invite_code: "ABC123" });
    const user = userEvent.setup();

    render(<MemoryRouter><CreateOrganizationPage /></MemoryRouter>);
    await user.type(screen.getByLabelText(/workspace name/i), "Acme Payments");
    await user.click(screen.getByRole("button", { name: /create workspace/i }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const [message, opts] = toastSuccess.mock.calls[0];
    expect(message).toContain("ABC123");
    // Persistent (never auto-dismisses) + explicitly closable, with a Copy action
    // (the 8s-flash was the bug). The action's clipboard write is a thin browser
    // call not worth stubbing jsdom for.
    expect(opts).toMatchObject({ duration: Infinity, closeButton: true });
    expect(opts.action.label).toMatch(/copy/i);
    expect(typeof opts.action.onClick).toBe("function");

    expect(navigateMock).toHaveBeenCalledWith("/dashboard", { replace: true });
  });
});
