/**
 * LogActivitySheet — verifies the 4-type expansion:
 *   - Call + Appointment ask for duration (required positive int)
 *   - Email + Drop-In skip duration entirely
 *   - All types route to useLogActivity with the correct `type` value
 *   - Cancel/Change-type returns to the picker without submitting
 *
 * The form itself (disposition tiles, follow-up preview) is tested via
 * the existing useLogActivity test + manual QA — this file focuses on
 * the per-type field gating that's new in this change.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mutateAsyncMock = vi.fn();
vi.mock("../hooks/useLogActivity", () => ({
  useLogActivity: () => ({
    mutateAsync: (input: unknown) => mutateAsyncMock(input),
    isPending: false,
  }),
}));

// NotesFieldWithMic and DispositionTile pull in audio APIs / animation —
// not relevant to this test. Stub them as simple inputs/buttons.
vi.mock("@/components/navigatr", async () => {
  const actual = await vi.importActual<typeof import("@/components/navigatr")>(
    "@/components/navigatr",
  );
  return {
    ...actual,
    NotesFieldWithMic: ({ id, value, onChange, placeholder }: {
      id: string;
      value: string;
      onChange: (v: string) => void;
      placeholder?: string;
    }) => (
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        data-testid="notes"
      />
    ),
  };
});

import { LogActivitySheet } from "./LogActivitySheet";

beforeEach(() => {
  mutateAsyncMock.mockReset();
  mutateAsyncMock.mockResolvedValue({ id: "act-1" });
});

function openSheet() {
  render(
    <LogActivitySheet open={true} onOpenChange={() => {}} dealId="deal-1" />,
  );
}

describe("LogActivitySheet — type picker", () => {
  it("renders all four type tiles", () => {
    openSheet();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("Call")).toBeInTheDocument();
    expect(screen.getByText("Drop-In")).toBeInTheDocument();
    expect(screen.getByText("Appointment")).toBeInTheDocument();
  });

  it("routes Email → form without duration field", () => {
    openSheet();
    fireEvent.click(screen.getByText("Email"));
    expect(screen.getByText(/log email/i)).toBeInTheDocument();
    // No "Duration" label, no minutes suffix.
    expect(screen.queryByLabelText(/duration/i)).not.toBeInTheDocument();
  });

  it("routes Drop-In → form without duration field", () => {
    openSheet();
    fireEvent.click(screen.getByText("Drop-In"));
    expect(screen.getByText(/log drop-in/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/duration/i)).not.toBeInTheDocument();
  });

  it("routes Call → form with duration field", () => {
    openSheet();
    fireEvent.click(screen.getByText("Call"));
    expect(screen.getByText(/log call/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/duration/i)).toBeInTheDocument();
  });

  it("routes Appointment → form with Length field (duration alias)", () => {
    openSheet();
    fireEvent.click(screen.getByText("Appointment"));
    expect(screen.getByText(/log appointment/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/length/i)).toBeInTheDocument();
  });
});

describe("LogActivitySheet — submission payload by type", () => {
  it("Email submit sends type='email' and durationMinutes=null", async () => {
    openSheet();
    fireEvent.click(screen.getByText("Email"));

    // Pick a disposition tile. Each DispositionTile renders as a button
    // with the disposition's label.
    fireEvent.click(screen.getByText(/positive engagement/i));

    fireEvent.click(screen.getByRole("button", { name: /log activity/i }));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalled());
    expect(mutateAsyncMock.mock.calls[0][0]).toMatchObject({
      type: "email",
      durationMinutes: null,
      disposition: "positive_engagement",
    });
  });

  it("Drop-In submit sends type='drop_in' with a field-visit disposition and durationMinutes=null", async () => {
    openSheet();
    fireEvent.click(screen.getByText("Drop-In"));
    // Drop-in offers field-visit outcomes, not call dispositions.
    expect(screen.queryByText(/connected with dm/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/met with decision maker/i));
    fireEvent.click(screen.getByRole("button", { name: /log activity/i }));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalled());
    expect(mutateAsyncMock.mock.calls[0][0]).toMatchObject({
      type: "drop_in",
      disposition: "met_dm",
      durationMinutes: null,
    });
  });

  it("Appointment submit sends type='appointment' and the entered duration", async () => {
    openSheet();
    fireEvent.click(screen.getByText("Appointment"));

    fireEvent.input(screen.getByLabelText(/length/i), { target: { value: "30" } });
    fireEvent.click(screen.getByText(/positive engagement/i));
    fireEvent.click(screen.getByRole("button", { name: /log activity/i }));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalled());
    expect(mutateAsyncMock.mock.calls[0][0]).toMatchObject({
      type: "appointment",
      durationMinutes: 30,
    });
  });
});

describe("LogActivitySheet — defaultType", () => {
  it("opens directly on the form when defaultType is set", () => {
    render(<LogActivitySheet open onOpenChange={vi.fn()} dealId="deal-1" defaultType="call" />);
    // Form title is "Log activity" (shared with the submit button); the
    // type-picker title is "What did you do?". On the Call form we see the
    // duration field and no picker title.
    expect(screen.getAllByText(/log activity/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/duration/i)).toBeInTheDocument();
    expect(screen.queryByText(/what did you do\?/i)).not.toBeInTheDocument();
  });
});

describe("LogActivitySheet — change-type navigation", () => {
  it("'Change type' button returns to the picker without submitting", () => {
    openSheet();
    fireEvent.click(screen.getByText("Email"));
    expect(screen.getByText(/log email/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /change type/i }));

    // Back at the picker.
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("Call")).toBeInTheDocument();
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });
});
