import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { InviteAgentModal } from "./InviteAgentModal";

const mutateAsyncMock = vi.fn();
vi.mock("../hooks/useAdminBulkInvite", () => ({
  useAdminBulkInvite: () => ({ mutateAsync: mutateAsyncMock }),
}));

vi.mock("../hooks/useSendInviteEmails", () => ({
  useSendInviteEmails: () => ({ mutateAsync: vi.fn().mockResolvedValue([]) }),
}));

// Leaderboard rows populate the "Reports to" select. Mix of manager-and-above
// (admin + manager, both active), a rep, and a manager-level pending invite —
// only the first two may be picked as a manager.
vi.mock("../hooks/useTeamLeaderboard", () => ({
  useTeamLeaderboard: () => ({
    data: [
      { agent_id: "mgr-1", full_name: "Mike Manager", email: "mike@x.com", role_level: "sales_manager", status: "active" },
      { agent_id: "adm-1", full_name: "Alice Admin", email: "alice@x.com", role_level: "administrator", status: "active" },
      { agent_id: "rep-1", full_name: "Rita Rep", email: "rita@x.com", role_level: "sales_professional", status: "active" },
      { agent_id: "inv-1", full_name: "Ivan Invited", email: "ivan@x.com", role_level: "sales_manager", status: "invited" },
    ],
  }),
}));

// Radix Select uses pointer APIs + scrollIntoView that jsdom lacks.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

beforeEach(() => {
  mutateAsyncMock.mockReset();
});

describe("InviteAgentModal", () => {
  it("submits a single row with the default role_level and no reports_to", async () => {
    const user = userEvent.setup();
    mutateAsyncMock.mockResolvedValueOnce([{ email: "a@x.com", id: "i1", ok: true, error: null }]);
    render(<InviteAgentModal open onOpenChange={() => {}} />);
    await user.type(screen.getByLabelText(/work email/i), "a@x.com");
    await user.click(screen.getByRole("button", { name: /send invite/i }));
    expect(mutateAsyncMock).toHaveBeenCalledWith([
      { email: "a@x.com", full_name: null, role_level: "sales_professional" },
    ]);
  });

  it("reports-to offers only manager-and-above active members plus No manager", () => {
    render(<InviteAgentModal open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByLabelText(/reports to/i));

    expect(screen.getByRole("option", { name: "No manager" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Alice Admin" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Mike Manager" })).toBeInTheDocument();
    // A rep and a pending invite can never be a manager.
    expect(screen.queryByRole("option", { name: "Rita Rep" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Ivan Invited" })).not.toBeInTheDocument();
  });

  it("submits the chosen role_level and reports_to when a manager is picked", async () => {
    mutateAsyncMock.mockResolvedValueOnce([{ email: "b@x.com", id: "i2", ok: true, error: null }]);
    render(<InviteAgentModal open onOpenChange={() => {}} />);

    fireEvent.change(screen.getByLabelText(/work email/i), { target: { value: "b@x.com" } });

    // Role level → Sales Manager
    fireEvent.click(screen.getByLabelText(/role level/i));
    fireEvent.click(screen.getByRole("option", { name: "Sales Manager" }));

    // Reports to → Mike Manager
    fireEvent.click(screen.getByLabelText(/reports to/i));
    fireEvent.click(screen.getByRole("option", { name: "Mike Manager" }));

    fireEvent.click(screen.getByRole("button", { name: /send invite/i }));

    await vi.waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1));
    expect(mutateAsyncMock.mock.calls[0][0]).toEqual([
      { email: "b@x.com", full_name: null, role_level: "sales_manager", reports_to: "mgr-1" },
    ]);
  });
});
