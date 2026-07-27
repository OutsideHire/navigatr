// Tests AppointmentOutcomeSheet: the rep-facing capture sheet for one of the
// nine appt_* outcomes on a past-due scheduled appointment. Mirrors
// DropInSheet.test.tsx's mocking style (mock the mutation hook + sonner) since
// this sheet follows the same explicit-commit shape: pick a tile, optionally
// add a note, tap "Log outcome" to commit.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("../hooks/useRecordAppointmentOutcome", () => ({
  useRecordAppointmentOutcome: () => ({ mutateAsync, isPending: false }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const { AppointmentOutcomeSheet } = await import("./AppointmentOutcomeSheet");
import { toast } from "sonner";

const onOpenChange = vi.fn();

function renderSheet(extra: Partial<React.ComponentProps<typeof AppointmentOutcomeSheet>> = {}) {
  return render(
    <AppointmentOutcomeSheet
      open
      onOpenChange={onOpenChange}
      appointmentId="appt-1"
      dealId="deal-1"
      merchantName="Bluewater"
      hasFutureAppointment={false}
      {...extra}
    />,
  );
}

const logOutcomeBtn = () => screen.getByRole("button", { name: /log outcome/i });

describe("AppointmentOutcomeSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue(undefined);
    onOpenChange.mockClear();
  });

  it("renders the 5 primary outcome tiles", () => {
    renderSheet();
    expect(screen.getByText("Presented, awaiting decision")).toBeInTheDocument();
    expect(screen.getByText("Statements collected")).toBeInTheDocument();
    expect(screen.getByText("Verbal commitment")).toBeInTheDocument();
    expect(screen.getByText("No show")).toBeInTheDocument();
    expect(screen.getByText("Rescheduled on the spot")).toBeInTheDocument();
  });

  it("does not show the 4 secondary tiles until More is tapped", () => {
    renderSheet();
    expect(screen.queryByText("Application signed")).not.toBeInTheDocument();
    expect(screen.queryByText("Decision maker not available")).not.toBeInTheDocument();
    expect(screen.queryByText("Cancelled by merchant")).not.toBeInTheDocument();
    expect(screen.queryByText("Not interested")).not.toBeInTheDocument();
  });

  it("More reveals the 4 secondary tiles", () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    expect(screen.getByText("Application signed")).toBeInTheDocument();
    expect(screen.getByText("Decision maker not available")).toBeInTheDocument();
    expect(screen.getByText("Cancelled by merchant")).toBeInTheDocument();
    expect(screen.getByText("Not interested")).toBeInTheDocument();
  });

  it("Log outcome is disabled until a tile is selected", () => {
    renderSheet();
    expect(logOutcomeBtn()).toBeDisabled();
    fireEvent.click(screen.getByText("No show"));
    expect(logOutcomeBtn()).toBeEnabled();
  });

  it("selecting Not interested reveals the Do not contact checkbox", () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    expect(screen.queryByText(/do not contact/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Not interested"));
    expect(screen.getByText(/do not contact/i)).toBeInTheDocument();
  });

  it("the Do not contact checkbox is absent for other outcomes", () => {
    renderSheet();
    fireEvent.click(screen.getByText("No show"));
    expect(screen.queryByText(/do not contact/i)).not.toBeInTheDocument();
  });

  it("switching away from Not interested hides the Do not contact checkbox again", () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    fireEvent.click(screen.getByText("Not interested"));
    expect(screen.getByText(/do not contact/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText("No show"));
    expect(screen.queryByText(/do not contact/i)).not.toBeInTheDocument();
  });

  it("submitting calls the hook with the selected outcome, notes, hasFutureAppointment, and doNotContact", async () => {
    renderSheet({ hasFutureAppointment: true });
    fireEvent.click(screen.getByText("Verbal commitment"));
    fireEvent.change(
      screen.getByPlaceholderText(/what was discussed/i),
      { target: { value: "Owner is ready to move forward" } },
    );
    await act(async () => { fireEvent.click(logOutcomeBtn()); });

    expect(mutateAsync).toHaveBeenCalledWith({
      appointmentId: "appt-1",
      dealId: "deal-1",
      outcome: "appt_verbal_commitment",
      notes: "Owner is ready to move forward",
      hasFutureAppointment: true,
      doNotContact: false,
    });
    expect(toast.success).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("submitting Not interested with the checkbox checked sends doNotContact true", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    fireEvent.click(screen.getByText("Not interested"));
    fireEvent.click(screen.getByRole("checkbox", { name: /do not contact/i }));
    await act(async () => { fireEvent.click(logOutcomeBtn()); });

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "appt_not_interested", doNotContact: true }),
    );
  });

  it("on failure: shows an error toast and does not close the sheet", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("boom"));
    renderSheet();
    fireEvent.click(screen.getByText("No show"));
    await act(async () => { fireEvent.click(logOutcomeBtn()); });
    expect(toast.error).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
