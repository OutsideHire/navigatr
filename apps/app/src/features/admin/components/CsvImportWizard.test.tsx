import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { CsvImportWizard } from "./CsvImportWizard";

vi.mock("../hooks/useAdminBulkInvite", () => ({
  useAdminBulkInvite: () => ({ mutateAsync: vi.fn().mockResolvedValue([
    { email: "a@x.com", id: "i1", ok: true, error: null },
  ]) }),
}));
vi.mock("../hooks/useSendInviteEmails", () => ({
  useSendInviteEmails: () => ({ mutateAsync: vi.fn().mockResolvedValue([]) }),
}));

describe("CsvImportWizard", () => {
  it("walks upload → preview → submit → done", async () => {
    const user = userEvent.setup();
    const { container } = render(<CsvImportWizard />);

    const file = new File(["email,full_name\na@x.com,Alice"], "agents.csv", { type: "text/csv" });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    expect(await screen.findByText(/ready to invite/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /send 1 invites/i }));
    expect(await screen.findByText(/import complete/i)).toBeInTheDocument();
    expect(screen.getByText(/1 invites sent/)).toBeInTheDocument();
  });
});
