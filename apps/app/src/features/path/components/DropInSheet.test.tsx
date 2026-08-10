// Tests for DropInSheet (explicit-commit redesign):
//   - Tapping a tile SELECTS it; nothing commits until "Log Stop".
//   - Log Stop disabled until a disposition is selected.
//   - Terminal disposition → logVisit only, no deal; follow-up → deal + activity
//     (voiceNoteUrl: null). Follow-Up Requested commits with the chosen date.
//   - Voice note is a disabled "Coming soon" placeholder.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

// ── Mocks ───────────────────────────────────────────────────────────
const createDealMutateAsync = vi.fn().mockResolvedValue({ id: "deal-1" });
const logActivityMutateAsync = vi.fn().mockResolvedValue({ id: "act-1" });

const { DuplicateDealError } = vi.hoisted(() => {
  class DuplicateDealError extends Error {
    constructor() {
      super("dup");
      this.name = "DuplicateDealError";
    }
  }
  return { DuplicateDealError };
});
vi.mock("@/features/pipeline/hooks/useCreateDeal", () => ({
  useCreateDeal: () => ({ mutateAsync: createDealMutateAsync }),
  DuplicateDealError,
}));

vi.mock("@/features/activities/hooks/useLogActivity", () => ({
  useLogActivity: () => ({ mutateAsync: logActivityMutateAsync }),
}));

// Calendar follow-up sync fires after the drop-in log succeeds for a created
// deal. Fire-and-forget; mock it to assert it's invoked with the deal id.
const syncFollowupMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/features/appointments/useFollowupSync", () => ({
  useFollowupSync: () => ({ syncFollowup: syncFollowupMock }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

// Stub the dictation field to a plain textarea so this test stays focused on the
// drop-in flow (the mic/recorder internals are covered by NotesFieldWithMic's own tests).
vi.mock("@/components/navigatr", async (orig) => {
  const actual = await orig<typeof import("@/components/navigatr")>();
  return {
    ...actual,
    NotesFieldWithMic: ({ value, onChange, placeholder, disabled }: {
      value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean;
    }) => (
      <textarea
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    ),
  };
});

const logVisit = vi.fn();
const markDealCreated = vi.fn();
// Mutable so individual tests can seed the stop snapshot (e.g. dealCreated:true).
let stops: Array<{ merchantId: string; dealCreated: boolean }> = [];
vi.mock("../hooks/useTodayPath", () => ({
  useTodayPath: () => ({ logVisit, markDealCreated, stops }),
}));

const { DropInSheet } = await import("./DropInSheet");
import { toast } from "sonner";
import type { Merchant } from "../mockData";

const merchant: Merchant = {
  id: "m-1",
  name: "Bluewater",
  category: "restaurants_bars_entertainment",
  address: "123 Main St",
  lat: 40,
  lng: -74,
  phone: "+15551234567",
  employeeCountRange: "1-10",
  status: "untouched",
  lastActivity: null,
  placeId: "gp-blue-1",
};

const onOpenChange = vi.fn();

function renderSheet(extra: Partial<React.ComponentProps<typeof DropInSheet>> = {}) {
  return render(
    <DropInSheet merchant={merchant} open onOpenChange={onOpenChange} {...extra} />,
  );
}

const logStopBtn = () => screen.getByRole("button", { name: /log stop/i });

describe("DropInSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDealMutateAsync.mockResolvedValue({ id: "deal-1" });
    logActivityMutateAsync.mockResolvedValue({ id: "act-1" });
    logVisit.mockClear();
    markDealCreated.mockClear();
    onOpenChange.mockClear();
    stops = [];
  });

  it("renders the 10 tiles with casual rep labels (no formal labels, no intervals), a Log Stop button, and no Save/contact-name field", () => {
    renderSheet();
    // Casual rep-facing labels replace the formal DISPOSITIONS labels here.
    expect(screen.getByText("Got statements")).toBeInTheDocument();
    expect(screen.getByText("Best case")).toBeInTheDocument();
    expect(screen.getByText("Met the owner")).toBeInTheDocument();
    expect(screen.getByText("Wrong place")).toBeInTheDocument();
    // The formal manager-facing labels must NOT show on the rep logging grid.
    expect(screen.queryByText("Statement Secured")).not.toBeInTheDocument();
    expect(screen.queryByText("Connected with DM")).not.toBeInTheDocument();
    // Interval / day-count subtitles are hidden on the rep logging grid.
    expect(screen.queryByText(/\b\d+\s*days?\b/i)).not.toBeInTheDocument();
    expect(logStopBtn()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/contact name/i)).not.toBeInTheDocument();
  });

  it("renders an optional dictated note field (replaces the old 'Coming soon' placeholder)", () => {
    renderSheet();
    expect(screen.getByText(/notes \(optional\)/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/add a note/i)).toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });

  it("tapping a tile selects it but does NOT commit", () => {
    const onLogged = vi.fn();
    renderSheet({ onLogged });
    fireEvent.click(screen.getByText("Got statements"));
    expect(logVisit).not.toHaveBeenCalled();
    expect(createDealMutateAsync).not.toHaveBeenCalled();
    expect(onLogged).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("Log Stop is disabled with no selection and enabled after selecting", () => {
    renderSheet();
    expect(logStopBtn()).toBeDisabled();
    fireEvent.click(screen.getByText("Not interested"));
    expect(logStopBtn()).toBeEnabled();
  });

  it("terminal disposition + Log Stop logs the visit only, then closes", async () => {
    const onLogged = vi.fn();
    renderSheet({ onLogged });
    fireEvent.click(screen.getByText("Not interested"));
    await act(async () => { fireEvent.click(logStopBtn()); });
    expect(logVisit).toHaveBeenCalledWith("m-1", "not_interested", "");
    expect(createDealMutateAsync).not.toHaveBeenCalled();
    // Terminal disposition creates no deal, so there's nothing to reconcile.
    expect(syncFollowupMock).not.toHaveBeenCalled();
    expect(onLogged).toHaveBeenCalledWith("not_interested");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("follow-up disposition + Log Stop creates deal + activity (voiceNoteUrl null)", async () => {
    renderSheet();
    fireEvent.click(screen.getByText("Got statements"));
    await act(async () => { fireEvent.click(logStopBtn()); });
    expect(logVisit).toHaveBeenCalledWith("m-1", "statement_secured", "");
    expect(createDealMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        contactName: "Bluewater",
        leadSource: "path",
        placeId: "gp-blue-1",
      }),
    );
    expect(logActivityMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "drop_in",
        disposition: "statement_secured",
        followUpDate: expect.any(String),
        voiceNoteUrl: null,
      }),
    );
    expect(markDealCreated).toHaveBeenCalledWith("m-1");
    // The new deal's follow-up event is reconciled with the created deal id.
    await waitFor(() => expect(syncFollowupMock).toHaveBeenCalledWith("deal-1"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Follow-Up Requested: date picker shows; Log Stop commits with the chosen date", async () => {
    renderSheet();
    fireEvent.click(screen.getByText("They asked me back"));
    const dateInput = screen.getByLabelText(/follow-up date/i);
    fireEvent.change(dateInput, { target: { value: "2026-06-20" } });
    await act(async () => { fireEvent.click(logStopBtn()); });
    expect(logVisit).toHaveBeenCalledWith("m-1", "followup_requested", "");
    expect(logActivityMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        disposition: "followup_requested",
        followUpDate: expect.stringContaining("2026-06-20"),
        voiceNoteUrl: null,
      }),
    );
  });

  it("Follow-Up Requested: Log Stop is disabled when the date is cleared", () => {
    renderSheet();
    fireEvent.click(screen.getByText("They asked me back"));
    fireEvent.change(screen.getByLabelText(/follow-up date/i), { target: { value: "" } });
    expect(logStopBtn()).toBeDisabled();
  });

  it("skips deal creation when the stop already has a deal", async () => {
    stops = [{ merchantId: "m-1", dealCreated: true }];
    renderSheet();
    fireEvent.click(screen.getByText("Got statements"));
    await act(async () => { fireEvent.click(logStopBtn()); });
    await waitFor(() => expect(logVisit).toHaveBeenCalledWith("m-1", "statement_secured", ""));
    expect(createDealMutateAsync).not.toHaveBeenCalled();
    expect(logActivityMutateAsync).not.toHaveBeenCalled();
    expect(markDealCreated).not.toHaveBeenCalled();
  });

  it("guards against double-submit: rapid Log Stop clicks log the visit once", async () => {
    renderSheet();
    fireEvent.click(screen.getByText("Got statements"));
    const btn = logStopBtn();
    await act(async () => { fireEvent.click(btn); fireEvent.click(btn); });
    expect(logVisit).toHaveBeenCalledTimes(1);
  });

  it("on activity-write failure: error toast, no markDealCreated, still closes + onLogged", async () => {
    logActivityMutateAsync.mockRejectedValueOnce(new Error("boom"));
    const onLogged = vi.fn();
    renderSheet({ onLogged });
    fireEvent.click(screen.getByText("Got statements"));
    await act(async () => { fireEvent.click(logStopBtn()); });
    expect(toast.error).toHaveBeenCalled();
    expect(markDealCreated).not.toHaveBeenCalled();
    expect(onLogged).toHaveBeenCalledWith("statement_secured");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("on logVisit failure: error toast, does NOT close or fire onLogged (retryable)", async () => {
    logVisit.mockRejectedValueOnce(new Error("net"));
    const onLogged = vi.fn();
    renderSheet({ onLogged });
    fireEvent.click(screen.getByText("Not interested"));
    await act(async () => { fireEvent.click(logStopBtn()); });
    expect(toast.error).toHaveBeenCalled();
    expect(onLogged).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("on a duplicate (DuplicateDealError): info toast, no error toast, no markDealCreated", async () => {
    createDealMutateAsync.mockRejectedValueOnce(new DuplicateDealError());
    const onLogged = vi.fn();
    renderSheet({ onLogged });
    fireEvent.click(screen.getByText("Got statements"));
    await act(async () => { fireEvent.click(logStopBtn()); });
    expect(logVisit).toHaveBeenCalledWith("m-1", "statement_secured", "");
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining("already in your team's pipeline"),
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(markDealCreated).not.toHaveBeenCalled();
    expect(onLogged).toHaveBeenCalledWith("statement_secured");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("with no note typed, logs the drop-in activity with empty outcome notes", async () => {
    renderSheet();
    fireEvent.click(screen.getByText("Got statements"));
    await act(async () => { fireEvent.click(logStopBtn()); });
    expect(logActivityMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ type: "drop_in", outcomeNotes: "" }),
    );
  });

  it("forwards a typed note to the visit and onto the deal activity (follow-up outcome)", async () => {
    renderSheet();
    fireEvent.click(screen.getByText("Got statements"));
    fireEvent.change(screen.getByPlaceholderText(/add a note/i), {
      target: { value: "Uses Square, come back Thursday" },
    });
    await act(async () => { fireEvent.click(logStopBtn()); });
    expect(logVisit).toHaveBeenCalledWith("m-1", "statement_secured", "Uses Square, come back Thursday");
    expect(logActivityMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ type: "drop_in", outcomeNotes: "Uses Square, come back Thursday" }),
    );
  });

  it("forwards a typed note on a terminal (no-deal) outcome to the visit", async () => {
    renderSheet();
    fireEvent.click(screen.getByText("Not interested"));
    fireEvent.change(screen.getByPlaceholderText(/add a note/i), {
      target: { value: "Owner was hostile, do not return" },
    });
    await act(async () => { fireEvent.click(logStopBtn()); });
    expect(logVisit).toHaveBeenCalledWith("m-1", "not_interested", "Owner was hostile, do not return");
    expect(createDealMutateAsync).not.toHaveBeenCalled();
  });
});
