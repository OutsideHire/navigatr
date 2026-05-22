import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { InviteAgentModal } from "./InviteAgentModal";

const mutateAsyncMock = vi.fn();
vi.mock("../hooks/useAdminBulkInvite", () => ({
  useAdminBulkInvite: () => ({ mutateAsync: mutateAsyncMock }),
}));

vi.mock("../hooks/useSendInviteEmails", () => ({
  useSendInviteEmails: () => ({ mutateAsync: vi.fn().mockResolvedValue([]) }),
}));

describe("InviteAgentModal", () => {
  it("submits a single row through useAdminBulkInvite", async () => {
    const user = userEvent.setup();
    mutateAsyncMock.mockResolvedValueOnce([{ email: "a@x.com", ok: true, error: null }]);
    render(<InviteAgentModal open onOpenChange={() => {}} />);
    await user.type(screen.getByLabelText(/work email/i), "a@x.com");
    await user.click(screen.getByRole("button", { name: /send invite/i }));
    expect(mutateAsyncMock).toHaveBeenCalledWith([{ email: "a@x.com", full_name: null, role: "rep" }]);
  });
});
