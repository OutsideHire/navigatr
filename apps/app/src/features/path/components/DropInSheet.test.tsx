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

  it("renders the 10 tiles, a Log Stop button, and no Save/contact-name field", () => {
    renderSheet();
    expect(screen.getByText("Statement Secured")).toBeInTheDocument();
    expect(screen.getByText("Highest urgency. 1 day.")).toBeInTheDocument();
    expect(screen.getByText("Wrong Person")).toBeInTheDocument();
    expect(logStopBtn()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/contact name/i)).not.toBeInTheDocument();
  });

  it("renders a disabled 'Coming soon' voice-note placeholder", () => {
    renderSheet();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /record a voice note/i })).toBeDisabled();
  });

  it("tapping a tile selects it but does NOT commit", () => {
    const onLogged = vi.fn();
    renderSheet({ onLogged });
    fireEvent.click(screen.getByText("Statement Secured"));
    expect(logVisit).not.toHaveBeenCalled();
    expect(createDealMutateAsync).not.toHaveBeenCalled();
    expect(onLogged).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("Log Stop is disabled with no selection and enabled after selecting", () => {
    renderSheet();
    expect(logStopBtn()).toBeDisabled();
    fireEvent.click(screen.getByText("Not Interested"));
    expect(logStopBtn()).toBeEnabled();
  });

  it("terminal disposition + Log Stop logs the visit only, then closes", async () => {
    const onLogged = vi.fn();
    renderSheet({ onLogged });
    fireEvent.click(screen.getByText("Not Interested"));
    await act(async () => { fireEvent.click(logStopBtn()); });
    expect(logVisit).toHaveBeenCalledWith("m-1", "not_interested");
    expect(createDealMutateAsync).not.toHaveBeenCalled();
    expect(onLogged).toHaveBeenCalledWith("not_interested");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("follow-up disposition + Log Stop creates deal + activity (voiceNoteUrl null)", async () => {
    renderSheet();
    fireEvent.click(screen.getByText("Statement Secured"));
    await act(async () => { fireEvent.click(logStopBtn()); });
    expect(logVisit).toHaveBeenCalledWith("m-1", "statement_secured");
    expect(createDealMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ contactName: "Bluewater", leadSource: "path_dropin" }),
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
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Follow-Up Requested: date picker shows; Log Stop commits with the chosen date", async () => {
    renderSheet();
    fireEvent.click(screen.getByText("Follow-Up Requested"));
    const dateInput = screen.getByLabelText(/follow-up date/i);
    fireEvent.change(dateInput, { target: { value: "2026-06-20" } });
    await act(async () => { fireEvent.click(logStopBtn()); });
    expect(logVisit).toHaveBeenCalledWith("m-1", "followup_requested");
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
    fireEvent.click(screen.getByText("Follow-Up Requested"));
    fireEvent.change(screen.getByLabelText(/follow-up date/i), { target: { value: "" } });
    expect(logStopBtn()).toBeDisabled();
  });

  it("skips deal creation when the stop already has a deal", async () => {
    stops = [{ merchantId: "m-1", dealCreated: true }];
    renderSheet();
    fireEvent.click(screen.getByText("Statement Secured"));
    await act(async () => { fireEvent.click(logStopBtn()); });
    await waitFor(() => expect(logVisit).toHaveBeenCalledWith("m-1", "statement_secured"));
    expect(createDealMutateAsync).not.toHaveBeenCalled();
    expect(logActivityMutateAsync).not.toHaveBeenCalled();
    expect(markDealCreated).not.toHaveBeenCalled();
  });

  it("guards against double-submit: rapid Log Stop clicks log the visit once", async () => {
    renderSheet();
    fireEvent.click(screen.getByText("Statement Secured"));
    const btn = logStopBtn();
    await act(async () => { fireEvent.click(btn); fireEvent.click(btn); });
    expect(logVisit).toHaveBeenCalledTimes(1);
  });

  it("on activity-write failure: error toast, no markDealCreated, still closes + onLogged", async () => {
    logActivityMutateAsync.mockRejectedValueOnce(new Error("boom"));
    const onLogged = vi.fn();
    renderSheet({ onLogged });
    fireEvent.click(screen.getByText("Statement Secured"));
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
    fireEvent.click(screen.getByText("Not Interested"));
    await act(async () => { fireEvent.click(logStopBtn()); });
    expect(toast.error).toHaveBeenCalled();
    expect(onLogged).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
