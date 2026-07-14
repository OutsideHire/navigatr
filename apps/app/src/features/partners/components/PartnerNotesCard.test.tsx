import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PartnerNotesCard } from "./PartnerNotesCard";
import type { PartnerNote } from "../partnerNotes";

const addMutate = vi.fn().mockResolvedValue(undefined);
const delMutate = vi.fn().mockResolvedValue(undefined);
const notesResult: { data: PartnerNote[]; isLoading: boolean; isError: boolean } = {
  data: [],
  isLoading: false,
  isError: false,
};

vi.mock("../hooks/usePartnerNotes", () => ({
  usePartnerNotes: () => notesResult,
  // key factory is imported by the mutation hooks, not this component; stub anyway.
  PARTNER_NOTES_QUERY_KEY: (u: string | undefined, p: string) => ["partnerNotes", "byPartner", u ?? "anon", p],
}));
vi.mock("../hooks/useAddPartnerNote", () => ({
  useAddPartnerNote: () => ({ mutateAsync: addMutate, isPending: false }),
}));
vi.mock("../hooks/useDeletePartnerNote", () => ({
  useDeletePartnerNote: () => ({ mutateAsync: delMutate, isPending: false }),
}));

let authUserId: string | undefined = "user-1";
let role: string | undefined = "rep";
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { role, org_id: "org-1" } }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

function note(overrides: Partial<PartnerNote> = {}): PartnerNote {
  return {
    id: "n-1",
    partnerId: "p-1",
    createdBy: "user-1",
    body: "Prefers texts over calls",
    createdAt: "2026-07-14T12:00:00.000Z",
    authorName: "Sarah Johnson",
    ...overrides,
  };
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PartnerNotesCard partnerId="p-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  addMutate.mockClear();
  delMutate.mockClear();
  notesResult.data = [];
  notesResult.isLoading = false;
  notesResult.isError = false;
  authUserId = "user-1";
  role = "rep";
});

describe("PartnerNotesCard", () => {
  it("shows the empty state when there are no notes", () => {
    renderCard();
    expect(screen.getByText(/No notes yet/i)).toBeTruthy();
  });

  it("adds a note via the composer", async () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /Add note/i }));
    fireEvent.change(screen.getByPlaceholderText(/Jot a quick note/i), {
      target: { value: "New banker intro" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save note/i }));
    await waitFor(() => expect(addMutate).toHaveBeenCalledTimes(1));
    expect(addMutate).toHaveBeenCalledWith({ partnerId: "p-1", body: "New banker intro" });
  });

  it("does not submit an empty/whitespace note", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /Add note/i }));
    fireEvent.change(screen.getByPlaceholderText(/Jot a quick note/i), { target: { value: "   " } });
    // Save is disabled for whitespace-only; clicking is a no-op.
    fireEvent.click(screen.getByRole("button", { name: /Save note/i }));
    expect(addMutate).not.toHaveBeenCalled();
  });

  it("renders a note with author + shows 'You' for the current user", () => {
    notesResult.data = [note({ createdBy: "user-1", authorName: "Sarah Johnson" })];
    renderCard();
    expect(screen.getByText("Prefers texts over calls")).toBeTruthy();
    expect(screen.getByText(/^You ·/)).toBeTruthy();
  });

  it("shows the author name for a teammate's note", () => {
    notesResult.data = [note({ id: "n-2", createdBy: "other", authorName: "Marcus Thompson" })];
    renderCard();
    expect(screen.getByText(/^Marcus Thompson ·/)).toBeTruthy();
  });

  it("hides Delete on a teammate's note for a rep", () => {
    notesResult.data = [note({ id: "n-2", createdBy: "other", authorName: "Marcus" })];
    role = "rep";
    renderCard();
    expect(screen.queryByRole("button", { name: /Delete|Confirm/ })).toBeNull();
  });

  it("deletes own note with a two-tap confirm", async () => {
    notesResult.data = [note({ id: "n-9", createdBy: "user-1" })];
    renderCard();
    const row = screen.getByText("Prefers texts over calls").closest("div")!.parentElement as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
    // First tap arms; mutation not fired yet.
    expect(delMutate).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(delMutate).toHaveBeenCalledTimes(1));
    expect(delMutate).toHaveBeenCalledWith({ noteId: "n-9", partnerId: "p-1" });
  });

  it("lets a manager delete a teammate's note", () => {
    notesResult.data = [note({ id: "n-2", createdBy: "other", authorName: "Marcus" })];
    role = "manager";
    renderCard();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });
});
