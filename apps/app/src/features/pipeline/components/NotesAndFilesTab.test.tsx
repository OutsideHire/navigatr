// Coverage for NotesAndFilesTab (Deal Notes & Files tab, Task 3).
//
// Mocks the four notes/files hooks + signedUrlFor + sonner. `notesData` and
// `filesData` are module-level so each test sets the lists before render.

import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { NotesAndFilesTab } from "./NotesAndFilesTab";
import { MOCK_DEALS } from "../mockData";
import { toast } from "sonner";

let notesData: any[] = [];
let filesData: any[] = [];
const createNote = vi.fn().mockResolvedValue({ id: "n1" });
const uploadFile = vi.fn().mockResolvedValue(undefined);

vi.mock("../hooks/useDealNotes", () => ({
  useDealNotes: () => ({ data: notesData, isLoading: false }),
  useCreateDealNote: () => ({ mutateAsync: createNote, isPending: false }),
  useDeleteDealNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../hooks/useDealFiles", () => ({
  useDealFiles: () => ({ data: filesData, isLoading: false }),
  useUploadDealFile: () => ({ mutateAsync: uploadFile, isPending: false }),
  useDeleteDealFile: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../lib/dealFileStorage", () => ({ signedUrlFor: vi.fn().mockResolvedValue("https://signed") }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const deal = MOCK_DEALS[0];

function renderTab() {
  return render(
    <MemoryRouter>
      <NotesAndFilesTab deal={deal} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  notesData = [];
  filesData = [];
  vi.clearAllMocks();
});

describe("NotesAndFilesTab", () => {
  it("(a) typing a note + clicking Add note calls createNote with {dealId, body}", async () => {
    const user = userEvent.setup();
    renderTab();

    const textarea = screen.getByPlaceholderText(/note/i);
    await user.type(textarea, "Called back");
    await user.click(screen.getByRole("button", { name: /add note/i }));

    expect(createNote).toHaveBeenCalledWith({ dealId: deal.id, body: "Called back" });
  });

  it("(b) note feed renders the note body; empty list shows an empty state", () => {
    notesData = [
      { id: "n1", dealId: deal.id, body: "Called back", createdBy: "u1", createdAt: new Date().toISOString() },
    ];
    const { unmount } = renderTab();
    expect(screen.getByText("Called back")).toBeInTheDocument();
    unmount();

    notesData = [];
    renderTab();
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
  });

  it("(c) files list renders the file name", () => {
    filesData = [
      {
        id: "f1", dealId: deal.id, path: "p", name: "contract.pdf", sizeBytes: 2048,
        contentType: "application/pdf", uploadedBy: "u1", createdAt: new Date().toISOString(),
      },
    ];
    renderTab();
    expect(screen.getByText("contract.pdf")).toBeInTheDocument();
  });

  it("(d) selecting an oversize file rejects: toast.error fires, uploadFile is NOT called", () => {
    const { container } = renderTab();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    const bigFile = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(bigFile, "size", { value: 11 * 1024 * 1024 });

    fireEvent.change(input, { target: { files: [bigFile] } });

    expect(toast.error).toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
  });
});
