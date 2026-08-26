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
  it("routes to the invite step (/welcome) after creating the workspace", async () => {
    mutateAsyncMock.mockResolvedValue({ invite_code: "ABC123" });
    const user = userEvent.setup();

    render(<MemoryRouter><CreateOrganizationPage /></MemoryRouter>);
    await user.type(screen.getByLabelText(/workspace name/i), "Acme Payments");
    // Consent is captured at this account-completion step (covers a brand-new
    // user who authenticated via Google, who never saw the signup checkbox).
    await user.click(screen.getByRole("checkbox", { name: /i agree to the terms/i }));
    await user.click(screen.getByRole("button", { name: /create workspace/i }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    // The invite code is now shown on /welcome (not a toast), so we just confirm
    // a success + the route into the activation step.
    expect(navigateMock).toHaveBeenCalledWith("/welcome", { replace: true });
  });

  it("does not create a workspace until Terms are agreed", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><CreateOrganizationPage /></MemoryRouter>);
    await user.type(screen.getByLabelText(/workspace name/i), "Acme Payments");
    // Submit WITHOUT agreeing.
    await user.click(screen.getByRole("button", { name: /create workspace/i }));
    expect(mutateAsyncMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/please agree to the terms/i)).toBeInTheDocument();
  });
});
