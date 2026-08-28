import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { CsvImportWizard } from "./CsvImportWizard";

vi.mock("../hooks/useAdminBulkInvite", () => ({
  useAdminBulkInvite: () => ({ mutateAsync: vi.fn().mockResolvedValue([
    { email: "a@x.com", id: "i1", ok: true, error: null },
  ]) }),
}));

const sendEmailsMock = vi.fn();
vi.mock("../hooks/useSendInviteEmails", () => ({
  useSendInviteEmails: () => ({ mutateAsync: sendEmailsMock }),
}));

async function runToDone() {
  const user = userEvent.setup();
  const { container } = render(<CsvImportWizard />);
  // No role_level column -> the one row's role is blank, which auto-maps to
  // Sales Professional, so the review step's Send button is ready immediately.
  const file = new File(["email,full_name\na@x.com,Alice"], "agents.csv", { type: "text/csv" });
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);
  expect(await screen.findByText(/1 person found/i)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /send 1 invite/i }));
  expect(await screen.findByText(/import complete/i)).toBeInTheDocument();
}

beforeEach(() => {
  sendEmailsMock.mockReset();
});

describe("CsvImportWizard", () => {
  it("walks upload → review → submit → done", async () => {
    sendEmailsMock.mockResolvedValue([{ id: "i1", ok: true }]);
    await runToDone();
    expect(screen.getByText(/1 invites sent/)).toBeInTheDocument();
    expect(screen.queryByText(/could not be sent/i)).not.toBeInTheDocument();
  });

  it("warns that emails could not be sent when the email send throws, still reporting the invites created", async () => {
    sendEmailsMock.mockRejectedValue(new Error("edge function not deployed"));
    await runToDone();
    // Invite still created.
    expect(screen.getByText(/1 invites sent/)).toBeInTheDocument();
    // But the email-not-sent warning is surfaced.
    expect(screen.getByText(/could not be sent/i)).toBeInTheDocument();
  });
});
