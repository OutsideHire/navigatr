import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import { WelcomeInvitePage } from "./WelcomeInvitePage";

const { navigateMock, bulkMock, sendMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  bulkMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let profileData: { role_level: string; role: string };
vi.mock("../useProfile", () => ({ useProfile: () => ({ data: profileData, isLoading: false }) }));
vi.mock("../useOrganization", () => ({ useOrganization: () => ({ data: { inviteCode: "ABC123" } }) }));
vi.mock("@/features/admin/hooks/useAdminBulkInvite", () => ({
  useAdminBulkInvite: () => ({ mutateAsync: bulkMock }),
}));
vi.mock("@/features/admin/hooks/useSendInviteEmails", () => ({
  useSendInviteEmails: () => ({ mutateAsync: sendMock }),
}));

beforeEach(() => {
  navigateMock.mockReset();
  bulkMock.mockReset();
  sendMock.mockReset();
});

function renderAt(roleLevel = "administrator") {
  profileData = { role_level: roleLevel, role: roleLevel === "administrator" ? "admin" : "rep" };
  render(
    <MemoryRouter initialEntries={["/welcome"]}>
      <Routes>
        <Route path="/welcome" element={<WelcomeInvitePage />} />
        <Route path="/dashboard" element={<div>dash</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("WelcomeInvitePage", () => {
  it("offers both invite paths for an inviter (email + share link)", () => {
    renderAt("administrator");
    expect(screen.getByLabelText("Teammate email 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send invites/i })).toBeInTheDocument();
    expect((screen.getByLabelText("Invite link") as HTMLInputElement).value).toContain("ABC123");
  });

  it("sends the typed invites then advances to the dashboard", async () => {
    bulkMock.mockResolvedValue([{ email: "rep@x.com", id: "i1", ok: true, error: null }]);
    sendMock.mockResolvedValue([]);
    const user = userEvent.setup();
    renderAt("administrator");

    await user.type(screen.getByLabelText("Teammate email 1"), "rep@x.com");
    await user.click(screen.getByRole("button", { name: /send invites/i }));

    expect(bulkMock).toHaveBeenCalledWith([{ email: "rep@x.com", full_name: null, role_level: "sales_professional" }]);
    expect(sendMock).toHaveBeenCalledWith(["i1"]);
    expect(navigateMock).toHaveBeenCalledWith("/dashboard", { replace: true });
  });

  it("redirects a non-inviter to the dashboard", () => {
    renderAt("sales_professional");
    expect(screen.getByText("dash")).toBeInTheDocument();
    expect(screen.queryByLabelText("Teammate email 1")).not.toBeInTheDocument();
  });

  it("lets the admin skip for now", async () => {
    const user = userEvent.setup();
    renderAt("administrator");
    await user.click(screen.getByRole("button", { name: /skip for now/i }));
    expect(navigateMock).toHaveBeenCalledWith("/dashboard", { replace: true });
  });
});
