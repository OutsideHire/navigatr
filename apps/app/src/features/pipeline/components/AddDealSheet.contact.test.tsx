// Path QA D: on the create-deal form, email must be optional and the phone
// field must delete naturally (format on blur, raw while editing).
//
// - Email: a deal submits with an EMPTY email (payload email is undefined, not
//   ""); a non-empty invalid email still errors; a valid email still works; the
//   Email field carries no required affordance.
// - Phone: the raw typed value flows through on change (so backspacing a
//   formatting char deletes naturally), then formats on blur; submit sends E.164.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AddDealSheet } from "./AddDealSheet";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("../hooks/useCreateDeal", () => ({
  useCreateDeal: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("../hooks/usePlaceResolver", () => ({
  usePlaceResolver: () => ({
    autocomplete: vi.fn().mockResolvedValue([]),
    resolveDetails: vi.fn(),
    newSession: vi.fn(),
  }),
}));
vi.mock("../hooks/usePlaceDuplicateCheck", () => ({
  usePlaceDuplicateCheck: () => ({
    checkPlaceDuplicate: vi.fn().mockResolvedValue(null),
  }),
}));
vi.mock("../hooks/useAttachPlaceToDeal", () => ({
  useAttachPlaceToDeal: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "u-1" } }),
  getProfession: () => "merchant_services",
}));

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

beforeEach(() => mutateAsync.mockClear());

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AddDealSheet open onOpenChange={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Fill the non-email required fields so a submit reaches the create mutation. */
async function fillRequiredExceptEmail() {
  renderSheet();
  fireEvent.change(document.getElementById("companyName") as HTMLInputElement, {
    target: { value: "Sunset Cafe" },
  });
  fireEvent.change(document.getElementById("contactName") as HTMLInputElement, {
    target: { value: "Jane Doe" },
  });
  fireEvent.change(document.getElementById("contactPhone") as HTMLInputElement, {
    target: { value: "3105551234" },
  });
  fireEvent.change(document.getElementById("dealValue") as HTMLInputElement, {
    target: { value: "5000" },
  });
  // Lead source is a Radix Select, so open it and pick a rep-pickable source.
  const user = userEvent.setup();
  await user.click(document.getElementById("leadSource") as HTMLElement);
  await user.click(await screen.findByRole("option", { name: /Inbound/i }));
}

describe("AddDealSheet: email is optional", () => {
  it("submits with an empty email (payload email undefined, not \"\")", async () => {
    await fillRequiredExceptEmail();

    fireEvent.click(screen.getByRole("button", { name: /Add deal/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const [payload] = mutateAsync.mock.calls[0];
    expect(payload.contactEmail).toBeUndefined();
  });

  it("still rejects a non-empty invalid email", async () => {
    await fillRequiredExceptEmail();
    fireEvent.change(document.getElementById("contactEmail") as HTMLInputElement, {
      target: { value: "not-an-email" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Add deal/i }));

    expect(await screen.findByText(/Enter a valid email/i)).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("passes a valid email through to the payload", async () => {
    await fillRequiredExceptEmail();
    fireEvent.change(document.getElementById("contactEmail") as HTMLInputElement, {
      target: { value: "jane@sunset.com" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Add deal/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const [payload] = mutateAsync.mock.calls[0];
    expect(payload.contactEmail).toBe("jane@sunset.com");
  });

  it("has no required affordance on the Email field", () => {
    renderSheet();
    const label = document.querySelector('label[for="contactEmail"]') as HTMLLabelElement;
    expect(label).not.toBeNull();
    expect(label.textContent).not.toContain("*");
    expect(label.querySelector('[title="Required"]')).toBeNull();
  });
});

describe("AddDealSheet: phone deletion is caret-free (format on blur)", () => {
  it("keeps the raw value on change and formats on blur", () => {
    renderSheet();
    const phone = document.getElementById("contactPhone") as HTMLInputElement;

    fireEvent.change(phone, { target: { value: "3105551234" } });
    // Raw value flows through, no live reformatting that would strand the caret.
    expect(phone.value).toBe("3105551234");

    fireEvent.blur(phone);
    expect((document.getElementById("contactPhone") as HTMLInputElement).value).toBe(
      "(310) 555-1234",
    );
  });

  it("shrinks the digits on successive deletions without a caret reposition", () => {
    renderSheet();
    const phone = document.getElementById("contactPhone") as HTMLInputElement;

    fireEvent.change(phone, { target: { value: "3105551234" } });
    fireEvent.blur(phone);
    expect(phone.value).toBe("(310) 555-1234");

    // Deleting formatting/area-code chars is reflected immediately.
    fireEvent.change(phone, { target: { value: "(310) 555-123" } });
    expect(phone.value).toBe("(310) 555-123");
    fireEvent.change(phone, { target: { value: "(310" } });
    expect(phone.value).toBe("(310");
    fireEvent.change(phone, { target: { value: "(31" } });
    expect(phone.value).toBe("(31");
    fireEvent.change(phone, { target: { value: "" } });
    expect(phone.value).toBe("");
  });

  it("submits the phone as E.164", async () => {
    await fillRequiredExceptEmail();

    fireEvent.click(screen.getByRole("button", { name: /Add deal/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const [payload] = mutateAsync.mock.calls[0];
    expect(payload.contactPhone).toBe("+13105551234");
  });
});
