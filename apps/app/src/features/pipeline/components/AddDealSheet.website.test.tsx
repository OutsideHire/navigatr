/**
 * A deal created from the pipeline's own business search carries the website.
 *
 * Until 2026-09-29 it could not: resolve_place excluded websiteUri from its
 * field mask by FR-ADD-PLC, and ResolvedPlace had no such field, so this was
 * the one creation path that could never give a deal a website even after the
 * column existed. The exclusion was reversed because websiteUri sits in the
 * same Enterprise Place Details SKU as nationalPhoneNumber, which the mask
 * already requests, so it costs nothing extra.
 *
 * BusinessSearchField is stubbed to a single button that hands back a resolved
 * place. The search UI has its own tests; what matters here is what AddDealSheet
 * does with the result.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AddDealSheet } from "./AddDealSheet";
import type { ResolvedPlace } from "../hooks/placeResolverTypes";

const PLACE: ResolvedPlace = {
  placeId: "ChIJ-bluefrog",
  name: "Bluefrog Plumbing",
  formattedAddress: "1100 Congress Ave, Austin, TX 78701",
  lat: 30.27,
  lng: -97.74,
  primaryType: "plumber",
  phone: "(512) 555-0101",
  website: "https://bluefrogplumbing.example",
  industry: "construction_trades",
};

const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("../hooks/useCreateDeal", () => ({
  useCreateDeal: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("../hooks/usePlaceResolver", () => ({
  usePlaceResolver: () => ({ autocomplete: vi.fn().mockResolvedValue([]), resolveDetails: vi.fn(), newSession: vi.fn() }),
}));
vi.mock("../hooks/usePlaceDuplicateCheck", () => ({
  usePlaceDuplicateCheck: () => ({ checkPlaceDuplicate: vi.fn().mockResolvedValue(null) }),
}));
vi.mock("../hooks/useAttachPlaceToDeal", () => ({
  useAttachPlaceToDeal: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../hooks/useDealSearchBias", () => ({ useDealSearchBias: () => undefined }));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: { id: "u-1" } }),
  getProfession: () => "merchant_services",
}));

// The seam: hand AddDealSheet a resolved place the way a rep's pick would.
let pickedPlace: ResolvedPlace = PLACE;
vi.mock("./BusinessSearchField", () => ({
  BusinessSearchField: ({ onResolve }: { onResolve: (p: ResolvedPlace) => void }) => (
    <button type="button" onClick={() => onResolve(pickedPlace)}>
      pick a business
    </button>
  ),
}));

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  mutateAsync.mockClear();
  pickedPlace = PLACE;
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

async function pickAndSubmit() {
  renderSheet();
  fireEvent.click(screen.getByRole("button", { name: /pick a business/i }));
  fireEvent.click(screen.getByRole("button", { name: /Add deal/i }));
  await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
  return mutateAsync.mock.calls[0][0];
}

describe("AddDealSheet: a search-created deal keeps the website", () => {
  it("passes the resolved website through to the deal", async () => {
    const payload = await pickAndSubmit();
    expect(payload.website).toBe("https://bluefrogplumbing.example");
  });

  it("sends undefined, not an empty string, when Google has no website", async () => {
    // The column should read "there isn't one", not "" — the same distinction
    // the migration comment makes.
    pickedPlace = { ...PLACE, website: null };
    const payload = await pickAndSubmit();
    expect(payload.website).toBeUndefined();
  });

  it("still carries the rest of the Places detail it always did", async () => {
    // Guards against the website wiring disturbing the fields that worked.
    const payload = await pickAndSubmit();
    expect(payload.placeId).toBe("ChIJ-bluefrog");
    expect(payload.address).toBe("1100 Congress Ave, Austin, TX 78701");
    expect(payload.lat).toBe(30.27);
    expect(payload.lng).toBe(-97.74);
  });
});
