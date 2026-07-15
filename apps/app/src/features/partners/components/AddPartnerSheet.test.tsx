// AddPartnerSheet — regression coverage for phone E.164 normalization on
// create. useCreatePartner is mocked as a capturable spy so we assert the
// exact payload that would hit Supabase.

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AddPartnerSheet } from "./AddPartnerSheet";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("../hooks/useCreatePartner", () => ({
  useCreatePartner: () => ({ mutateAsync, isPending: false }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => mutateAsync.mockClear());

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AddPartnerSheet open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

/** Fill the four required fields with valid values (type defaults to cpa). */
function fillRequired(phone: string) {
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Jane Doe" } });
  fireEvent.change(screen.getByLabelText(/^Company/), { target: { value: "Doe LLC" } });
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "jane@doe.com" } });
  fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: phone } });
}

describe("AddPartnerSheet — phone normalization", () => {
  it("stores a plain 10-digit phone as +1 + digits", async () => {
    renderSheet();
    fillRequired("(512) 555-2222");
    fireEvent.click(screen.getByRole("button", { name: /Add partner/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0].phone).toBe("+15125552222");
  });

  it("does not double the country code when typed with a leading 1", async () => {
    // Regression: leading "1" (11 digits) still validates; the create path
    // must strip it before prepending "+1", not produce "+112063834000".
    renderSheet();
    fillRequired("1 (206) 383-4000");
    fireEvent.click(screen.getByRole("button", { name: /Add partner/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0].phone).toBe("+12063834000");
  });

  it("still requires a phone (empty phone blocks create)", async () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Jane Doe" } });
    fireEvent.change(screen.getByLabelText(/^Company/), { target: { value: "Doe LLC" } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "jane@doe.com" } });
    // Leave phone empty.
    fireEvent.click(screen.getByRole("button", { name: /Add partner/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Add partner/i })).toBeTruthy());
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("trims the email on create", async () => {
    renderSheet();
    fillRequired("(512) 555-2222");
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "  jane@doe.com  " } });
    fireEvent.click(screen.getByRole("button", { name: /Add partner/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0].email).toBe("jane@doe.com");
  });
});
