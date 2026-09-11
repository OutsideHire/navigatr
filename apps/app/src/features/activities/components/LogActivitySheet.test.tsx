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

// Calendar follow-up sync fires after a successful log (the DB trigger has
// moved next_followup_at). Fire-and-forget; mock it to assert it's invoked.
const syncFollowupMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/features/appointments/useFollowupSync", () => ({
  useFollowupSync: () => ({ syncFollowup: syncFollowupMock }),
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
  syncFollowupMock.mockClear();
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

    // Pick an email disposition tile (SP2: email has its own set now).
    fireEvent.click(screen.getByText(/reply received/i));

    fireEvent.click(screen.getByRole("button", { name: /log activity/i }));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalled());
    expect(mutateAsyncMock.mock.calls[0][0]).toMatchObject({
      type: "email",
      durationMinutes: null,
      disposition: "reply_received",
    });
    // After the log succeeds, the deal's follow-up calendar event is reconciled.
    await waitFor(() => expect(syncFollowupMock).toHaveBeenCalledWith("deal-1"));
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

    // Appointment has its own outcome set, not the call dispositions.
    expect(screen.queryByText(/positive engagement/i)).not.toBeInTheDocument();
    fireEvent.input(screen.getByLabelText(/length/i), { target: { value: "30" } });
    fireEvent.click(screen.getByText(/verbal commitment/i));
    fireEvent.click(screen.getByRole("button", { name: /log activity/i }));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalled());
    expect(mutateAsyncMock.mock.calls[0][0]).toMatchObject({
      type: "appointment",
      durationMinutes: 30,
      disposition: "appt_verbal_commitment",
    });
  });
});

describe("LogActivitySheet: drop-in outcome set (the field-visit screen reps use)", () => {
  // Guard for the 2026-09 regression: an Aug-2026 driving-view redesign pointed
  // the Path stop logger at a stale outcome list that dropped "Got their
  // statement" and added "Other". A later fix corrected only the OTHER drop-in
  // sheet, so the screen reps actually use kept the wrong set. This asserts what
  // a rep SEES on this screen, so both a list change AND a component/flow swap
  // get caught, not just the underlying constant.
  const EXPECTED_IN_ORDER = [
    "Got their statement",
    "Met with decision maker",
    "Asked me to come back",
    "Spoke with gatekeeper",
    "Left materials",
    "Closed right now",
    "Not now",
    "Do not contact",
    "Out of business",
  ];

  it("shows the full Desired Outcome set in order, with no 'Other' and no 'show more'", () => {
    openSheet();
    fireEvent.click(screen.getByText("Drop-In"));

    for (const label of EXPECTED_IN_ORDER) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // The two things that defined the bug:
    expect(screen.getByText("Got their statement")).toBeInTheDocument(); // was missing
    expect(screen.queryByText("Other")).not.toBeInTheDocument(); // was present
    // Every outcome is shown at once (no top/all toggle for drop-in).
    expect(screen.queryByRole("button", { name: /show (all|top)/i })).not.toBeInTheDocument();

    // Tiles render top-to-bottom in the Desired order (grid places them in source
    // order, so DOM text order == the list order).
    const body = document.body.textContent ?? "";
    const positions = EXPECTED_IN_ORDER.map((l) => body.indexOf(l));
    expect(positions.every((p) => p >= 0)).toBe(true);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });
});

describe("LogActivitySheet — 'Asked me to come back' date capture", () => {
  // scheduled_callback ("Asked me to come back" / "He named a time") is a
  // field drop-in outcome whose rep copy promises the rep names a return time.
  // The manual drop-in sheet must therefore surface a date/time capture and use
  // the entered value AS the follow-up (asserted), same as a phone `callback` —
  // never silently fall back to the 2-business-day interval.
  function openDropInPickComeBack() {
    openSheet();
    fireEvent.click(screen.getByText("Drop-In"));
    // Drop-in shows every outcome at once (top == all, no "show all" toggle), so
    // "Asked me to come back" is visible immediately.
    fireEvent.click(screen.getByText(/asked me to come back/i));
  }

  it("reveals the return date/time capture when the outcome is selected", () => {
    openDropInPickComeBack();
    expect(screen.getByLabelText(/when to come back/i)).toBeInTheDocument();
  });

  it("blocks submit and shows an error when no return time is entered", async () => {
    openDropInPickComeBack();
    fireEvent.click(screen.getByRole("button", { name: /log activity/i }));

    expect(
      await screen.findByText(/enter when they asked you to come back/i),
    ).toBeInTheDocument();
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it("submits the entered return time as an asserted follow-up", async () => {
    openDropInPickComeBack();
    fireEvent.change(screen.getByLabelText(/when to come back/i), {
      target: { value: "2026-09-01T10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /log activity/i }));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalled());
    expect(mutateAsyncMock.mock.calls[0][0]).toMatchObject({
      type: "drop_in",
      disposition: "scheduled_callback",
      followUpDate: "2026-09-01T10:00",
      followUpDateSource: "asserted",
    });
  });
});

describe("LogActivitySheet: drop-in follow-up timing on each outcome (parity with DropInSheet)", () => {
  // Robert QA (2026-09): the stop logger's drop-in outcomes must show the same
  // per-tile follow-up timing the nearby-stop DropInSheet shows (feature #149:
  // "N-day follow-up" / "You pick the date"), and "Asked me to come back" must
  // read as pick-a-date, not show a contradictory auto-computed follow-up. Those
  // landed on DropInSheet only; this component is the stop logger reps hit on
  // return visits (and the Activities logger), so it needs parity.
  function openDropIn() {
    openSheet();
    fireEvent.click(screen.getByText("Drop-In"));
  }

  it("shows the follow-up timing line on the drop-in outcome tiles", () => {
    openDropIn();
    // scheduled_callback surfaces the pick-the-date cue (unique to that outcome);
    // fixed-interval outcomes each show an N-day follow-up line.
    expect(screen.getByText("You pick the date")).toBeInTheDocument();
    expect(screen.getAllByText(/\d+-day follow-up/i).length).toBeGreaterThan(0);
  });

  it("does not show a computed 'smart follow-up' preview for the date-pinned 'Asked me to come back'", () => {
    openDropIn();
    fireEvent.click(screen.getByText(/asked me to come back/i));
    // The rep pins the return date below; an auto-computed preview would
    // contradict the picker, so it must not appear.
    expect(screen.queryByText(/smart follow-up scheduled/i)).not.toBeInTheDocument();
    // The date capture is still the clear, single path.
    expect(screen.getByLabelText(/when to come back/i)).toBeInTheDocument();
  });
});

describe("LogActivitySheet inline post-log confirmation", () => {
  it("renders the confirmation title and lines inline after a successful log", async () => {
    // The hook returns a confirmation summary alongside the new id; the sheet
    // formats it and shows it inline (not just a corner toast).
    mutateAsyncMock.mockResolvedValueOnce({
      id: "act-1",
      confirmation: {
        activityType: "email",
        createdTasks: [],
        compound: false,
        recordEffects: [],
      },
    });

    openSheet();
    fireEvent.click(screen.getByText("Email"));
    fireEvent.click(screen.getByText(/reply received/i));
    fireEvent.click(screen.getByRole("button", { name: /log activity/i }));

    // The inline success panel shows what the platform just did.
    expect(await screen.findByText("Email logged")).toBeInTheDocument();
    expect(screen.getByText("No follow-up scheduled.")).toBeInTheDocument();
    // The panel is announced to assistive tech.
    expect(screen.getByRole("status")).toBeInTheDocument();
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


describe("LogActivitySheet — lockedType (Log outcome path)", () => {
  it("locks to the task's type: no picker, no Change type, titled Log outcome, with an editable time", () => {
    render(
      <LogActivitySheet open onOpenChange={vi.fn()} dealId="deal-1" lockedType="drop_in" closeTaskId="task-1" />,
    );
    // Opens straight on the form (no type picker), titled "Log outcome".
    expect(screen.getAllByText("Log outcome").length).toBeGreaterThan(0);
    expect(screen.queryByText(/what did you do\?/i)).not.toBeInTheDocument();
    // The inherited type cannot be changed.
    expect(screen.queryByRole("button", { name: /change type/i })).not.toBeInTheDocument();
    // The editable event-time field is present.
    expect(screen.getByLabelText(/^When$/i)).toBeInTheDocument();
  });
});
