// DeleteAccountDialog — confirmation friction works (typing DELETE
// guard), submission calls the hook, cancel doesn't.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mutateAsyncMock = vi.fn(() => Promise.resolve({ status: "anonymized", anonymized_at: "now" }));
vi.mock("./useDeleteAccount", () => ({
  useDeleteAccount: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
}));

import { DeleteAccountDialog } from "./DeleteAccountDialog";

function renderDialog(open = true) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DeleteAccountDialog open={open} onOpenChange={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mutateAsyncMock.mockClear();
});

describe("DeleteAccountDialog", () => {
  it("shows the warning copy + confirmation input + buttons when open", () => {
    renderDialog();
    expect(screen.getByText(/permanently anonymize your account/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/type delete to confirm/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete my account/i })).toBeInTheDocument();
  });

  it("disables the delete button until the user types DELETE", () => {
    renderDialog();
    const btn = screen.getByRole("button", { name: /delete my account/i });
    expect(btn).toBeDisabled();

    const input = screen.getByLabelText(/type delete to confirm/i);
    fireEvent.change(input, { target: { value: "delete" } }); // wrong case
    expect(btn).toBeDisabled();

    fireEvent.change(input, { target: { value: "DELET" } }); // typo
    expect(btn).toBeDisabled();

    fireEvent.change(input, { target: { value: "DELETE" } });
    expect(btn).not.toBeDisabled();
  });

  it("calls the deletion hook when confirmed", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), {
      target: { value: "DELETE" },
    });
    fireEvent.click(screen.getByRole("button", { name: /delete my account/i }));
    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT call the hook when the user clicks Cancel", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), {
      target: { value: "DELETE" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it("links to privacy@outsidehire.com for recovery / hard-delete requests", () => {
    renderDialog();
    const link = screen.getByRole("link", { name: /privacy@outsidehire/i });
    expect(link).toHaveAttribute("href", "mailto:privacy@outsidehire.com");
  });
});
