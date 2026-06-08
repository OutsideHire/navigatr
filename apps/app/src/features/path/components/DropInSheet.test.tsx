// Tests for DropInSheet (drop-in disposition redesign):
//   - Renders the 10 redesigned tiles with their sub-labels; no Save button,
//     no contact-name field.
//   - Tap-to-auto-save: tapping a follow-up disposition commits immediately
//     (logVisit + deal + activity + markDealCreated) and advances/closes.
//   - Tapping a terminal disposition logs the visit only — no deal.
//   - Follow-Up Requested reveals an inline date picker and does NOT commit
//     until confirmed.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

// ── Mocks ───────────────────────────────────────────────────────────
const createDealMutateAsync = vi.fn().mockResolvedValue({ id: "deal-1" });
const logActivityMutateAsync = vi.fn().mockResolvedValue({ id: "act-1" });

vi.mock("@/features/pipeline/hooks/useCreateDeal", () => ({
  useCreateDeal: () => ({ mutateAsync: createDealMutateAsync }),
}));

vi.mock("@/features/activities/hooks/useLogActivity", () => ({
  useLogActivity: () => ({ mutateAsync: logActivityMutateAsync }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const logVisit = vi.fn();
const markDealCreated = vi.fn();
// Mutable so individual tests can seed the stop snapshot (e.g. dealCreated:true).
let stops: Array<{ merchantId: string; dealCreated: boolean }> = [];
vi.mock("../hooks/useTodayPath", () => ({
  useTodayPath: () => ({ logVisit, markDealCreated, stops }),
}));

// Controllable voice recorder + upload + auth.
let recorderState = "idle";
const recorderBlob = new Blob(["x"], { type: "audio/webm" });
const recStart = vi.fn();
const recStop = vi.fn();
const recReset = vi.fn();
vi.mock("../hooks/useVoiceRecorder", () => ({
  useVoiceRecorder: () => ({
    state: recorderState,
    blob: recorderState === "recorded" ? recorderBlob : null,
    durationMs: 3000,
    mimeType: "audio/webm",
    start: recStart,
    stop: recStop,
    reset: recReset,
  }),
}));
const uploadVoiceNote = vi.fn().mockResolvedValue("user-1/x.webm");
vi.mock("../lib/voiceNoteStorage", () => ({
  uploadVoiceNote: (...a: unknown[]) => uploadVoiceNote(...a),
  signedUrlFor: vi.fn(),
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: "user-1" } }),
}));
// Keep these tests focused on commit wiring (the real recorder uses URL.createObjectURL).
vi.mock("./VoiceNoteRecorder", () => ({ VoiceNoteRecorder: () => null }));

const { DropInSheet } = await import("./DropInSheet");
import { toast } from "sonner";
import type { Merchant } from "../mockData";

const merchant: Merchant = {
  id: "m-1",
  name: "Bluewater",
  category: "food_beverage",
  address: "123 Main St",
  lat: 40,
  lng: -74,
  phone: "+15551234567",
  employeeCountRange: "1-10",
  status: "untouched",
  lastActivity: null,
};

const onOpenChange = vi.fn();

function renderSheet(extra: Partial<React.ComponentProps<typeof DropInSheet>> = {}) {
  return render(
    <DropInSheet merchant={merchant} open onOpenChange={onOpenChange} {...extra} />,
  );
}

describe("DropInSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDealMutateAsync.mockResolvedValue({ id: "deal-1" });
    logActivityMutateAsync.mockResolvedValue({ id: "act-1" });
    logVisit.mockClear();
    markDealCreated.mockClear();
    onOpenChange.mockClear();
    stops = [];
    recorderState = "idle";
    uploadVoiceNote.mockClear();
  });

  it("renders the 10 redesigned tiles with their sub-labels", () => {
    renderSheet();
    expect(screen.getByText("Statement Secured")).toBeInTheDocument();
    expect(screen.getByText("Highest urgency. 1 day.")).toBeInTheDocument();
    expect(screen.getByText("Wrong Person")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/contact name/i)).not.toBeInTheDocument();
  });

  it("tapping a follow-up disposition commits immediately: logVisit + deal + activity + advance", async () => {
    renderSheet();
    await act(async () => {
      fireEvent.click(screen.getByText("Statement Secured"));
    });
    expect(logVisit).toHaveBeenCalledWith("m-1", "statement_secured");
    expect(createDealMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ contactName: "Bluewater", leadSource: "path_dropin" }),
    );
    expect(logActivityMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "drop_in",
        disposition: "statement_secured",
        followUpDate: expect.any(String),
      }),
    );
    expect(markDealCreated).toHaveBeenCalledWith("m-1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("tapping a terminal disposition logs the visit only, no deal", async () => {
    renderSheet();
    await act(async () => {
      fireEvent.click(screen.getByText("Not Interested"));
    });
    expect(logVisit).toHaveBeenCalledWith("m-1", "not_interested");
    expect(createDealMutateAsync).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Follow-Up Requested reveals a date picker and does NOT commit until confirmed", async () => {
    renderSheet();
    fireEvent.click(screen.getByText("Follow-Up Requested"));
    expect(logVisit).not.toHaveBeenCalled();
    const dateInput = screen.getByLabelText(/follow-up date/i);
    fireEvent.change(dateInput, { target: { value: "2026-06-20" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /set follow-up/i }));
    });
    expect(logVisit).toHaveBeenCalledWith("m-1", "followup_requested");
    expect(logActivityMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        disposition: "followup_requested",
        followUpDate: expect.stringContaining("2026-06-20"),
      }),
    );
  });

  it("skips deal creation when the stop already has a deal", async () => {
    stops = [{ merchantId: "m-1", dealCreated: true }];
    renderSheet();
    await act(async () => {
      fireEvent.click(screen.getByText("Statement Secured"));
    });
    await waitFor(() => expect(logVisit).toHaveBeenCalledWith("m-1", "statement_secured"));
    expect(createDealMutateAsync).not.toHaveBeenCalled();
    expect(logActivityMutateAsync).not.toHaveBeenCalled();
    expect(markDealCreated).not.toHaveBeenCalled();
  });

  it("calls onLogged with the chosen disposition after commit", async () => {
    const onLogged = vi.fn();
    renderSheet({ onLogged });
    await act(async () => {
      fireEvent.click(screen.getByText("Not Interested"));
    });
    await waitFor(() => expect(onLogged).toHaveBeenCalledWith("not_interested"));
  });

  it("guards against double-submit: rapid taps log the visit once", async () => {
    renderSheet();
    const tile = screen.getByText("Statement Secured");
    await act(async () => { fireEvent.click(tile); fireEvent.click(tile); });
    expect(logVisit).toHaveBeenCalledTimes(1);
  });

  it("on activity-write failure: error toast, no markDealCreated, still closes + onLogged", async () => {
    logActivityMutateAsync.mockRejectedValueOnce(new Error("boom"));
    const onLogged = vi.fn();
    renderSheet({ onLogged });
    await act(async () => { fireEvent.click(screen.getByText("Statement Secured")); });
    expect(toast.error).toHaveBeenCalled();
    expect(markDealCreated).not.toHaveBeenCalled();
    expect(onLogged).toHaveBeenCalledWith("statement_secured");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("engaged disposition with a recording uploads + passes voiceNoteUrl to logActivity", async () => {
    recorderState = "recorded";
    renderSheet();
    await act(async () => { fireEvent.click(screen.getByText("Statement Secured")); });
    expect(uploadVoiceNote).toHaveBeenCalledWith(recorderBlob, "audio/webm", "user-1");
    expect(logActivityMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ voiceNoteUrl: "user-1/x.webm" }));
  });

  it("terminal disposition with a recording confirms, discards (no upload) on confirm", async () => {
    recorderState = "recorded";
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSheet();
    await act(async () => { fireEvent.click(screen.getByText("Not Interested")); });
    expect(confirmSpy).toHaveBeenCalled();
    expect(uploadVoiceNote).not.toHaveBeenCalled();
    expect(logVisit).toHaveBeenCalledWith("m-1", "not_interested");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("terminal + recording + confirm cancelled aborts the commit", async () => {
    recorderState = "recorded";
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderSheet();
    await act(async () => { fireEvent.click(screen.getByText("Not Interested")); });
    expect(logVisit).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("no recording: engaged commit passes voiceNoteUrl null, no upload", async () => {
    recorderState = "idle";
    renderSheet();
    await act(async () => { fireEvent.click(screen.getByText("Statement Secured")); });
    expect(uploadVoiceNote).not.toHaveBeenCalled();
    expect(logActivityMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ voiceNoteUrl: null }));
  });
});
