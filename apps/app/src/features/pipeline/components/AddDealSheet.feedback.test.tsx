// Pipeline "Add new deal" bug: a blocked submit gave no feedback where the rep
// was looking. Both blockers (required-field validation and the duplicate
// banner) render at the TOP of a long, scrolled form, above the "Add deal"
// button, so the button looked dead and reps reported "won't save".
//
// The fix surfaces the reason regardless of scroll position:
//  - validation-blocked  -> a toast + scroll the first invalid field into view
//  - duplicate-blocked   -> a toast + scroll the duplicate banner into view
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
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
const checkPlaceDuplicate = vi.fn().mockResolvedValue(null);
vi.mock("../hooks/usePlaceDuplicateCheck", () => ({
  usePlaceDuplicateCheck: () => ({ checkPlaceDuplicate }),
}));
vi.mock("../hooks/useAttachPlaceToDeal", () => ({
  useAttachPlaceToDeal: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "u-1" } }),
  getProfession: () => "merchant_services",
}));
vi.mock("sonner", () => {
  const fn = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { toast: fn };
});

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = vi.fn();
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

beforeEach(() => {
  mutateAsync.mockClear();
  checkPlaceDuplicate.mockClear();
  checkPlaceDuplicate.mockResolvedValue(null);
  (toast as unknown as ReturnType<typeof vi.fn>).mockClear();
  (toast.error as ReturnType<typeof vi.fn>).mockClear();
  (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
});

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

/** Fill every required field so a submit reaches the duplicate check + create. */
async function fillAllRequired() {
  fireEvent.change(document.getElementById("companyName") as HTMLInputElement, {
    target: { value: "Testing Co" },
  });
  fireEvent.change(document.getElementById("contactName") as HTMLInputElement, {
    target: { value: "Jane Doe" },
  });
  fireEvent.change(document.getElementById("contactPhone") as HTMLInputElement, {
    target: { value: "3105551234" },
  });
  fireEvent.change(document.getElementById("dealValue") as HTMLInputElement, {
    target: { value: "1200" },
  });
  const user = userEvent.setup();
  await user.click(document.getElementById("leadSource") as HTMLElement);
  await user.click(await screen.findByRole("option", { name: /Inbound/i }));
}

describe("AddDealSheet: blocked-submit feedback (won't-save bug)", () => {
  it("required fields missing -> shows a toast and does not silently no-op", async () => {
    renderSheet();
    // Submit with an empty form: the required fields (company, contact, phone,
    // value, source) all fail, and they sit above the button, out of view.
    fireEvent.click(screen.getByRole("button", { name: /Add deal/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("duplicate match -> surfaces the banner, scrolls it into view, and holds the save", async () => {
    checkPlaceDuplicate.mockResolvedValue({
      tier: "phone",
      dealId: "d-1",
      companyName: "Testing Co",
      dealHasPlaceId: false,
    });
    renderSheet();
    await fillAllRequired();
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();

    fireEvent.click(screen.getByRole("button", { name: /Add deal/i }));

    // The duplicate banner appears (an alert), the save is held, and the banner
    // is scrolled into view so a rep at the bottom of the form actually sees it.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).toHaveBeenCalled(),
    );
  });

  it("a valid, non-duplicate deal still saves normally", async () => {
    renderSheet();
    await fillAllRequired();

    fireEvent.click(screen.getByRole("button", { name: /Add deal/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalled();
  });
});
