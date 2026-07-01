import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as React from "react";

import { PlanScheduleStep, type DateQuickPick } from "./PlanScheduleStep";
import { addDaysISO, todayISO } from "../../lib/today";
import { nextMondayISO } from "../../lib/scheduleDate";

/** A stateful harness so the quick-picks + inputs behave like they do in the wizard. */
function Harness({ onDate }: { onDate?: (iso: string, pick: DateQuickPick) => void }) {
  const [date, setDate] = React.useState(addDaysISO(todayISO(), 1));
  const [pick, setPick] = React.useState<DateQuickPick>("tomorrow");
  const [time, setTime] = React.useState("08:30");
  const [name, setName] = React.useState("Austin, TX · Tomorrow");
  return (
    <PlanScheduleStep
      date={date}
      activePick={pick}
      reminderTime={time}
      name={name}
      dateValid={date >= todayISO()}
      onDateChange={(iso, p) => {
        setDate(iso);
        setPick(p);
        onDate?.(iso, p);
      }}
      onReminderTimeChange={setTime}
      onNameChange={setName}
    />
  );
}

describe("PlanScheduleStep", () => {
  it("defaults to Tomorrow", () => {
    render(<Harness />);
    const tomorrowBtn = screen.getByRole("button", { name: /^tomorrow/i });
    expect(tomorrowBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("Today quick-pick sets today's date", () => {
    const onDate = vi.fn();
    render(<Harness onDate={onDate} />);
    fireEvent.click(screen.getByRole("button", { name: /^today/i }));
    expect(onDate).toHaveBeenCalledWith(todayISO(), "today");
  });

  it("Next week quick-pick sets the next Monday", () => {
    const onDate = vi.fn();
    render(<Harness onDate={onDate} />);
    fireEvent.click(screen.getByRole("button", { name: /next week/i }));
    expect(onDate).toHaveBeenCalledWith(nextMondayISO(), "next_week");
  });

  it("exposes an editable reminder time input defaulting to 08:30", () => {
    render(<Harness />);
    const time = screen.getByLabelText(/remind me at/i) as HTMLInputElement;
    expect(time.value).toBe("08:30");
    fireEvent.change(time, { target: { value: "09:15" } });
    expect(time.value).toBe("09:15");
  });

  it("exposes an editable name field", () => {
    render(<Harness />);
    const name = screen.getByLabelText(/name this path/i) as HTMLInputElement;
    expect(name.value).toContain("Austin, TX");
    fireEvent.change(name, { target: { value: "Custom" } });
    expect(name.value).toBe("Custom");
  });

  it("shows a guard message when the date is invalid (past)", () => {
    render(
      <PlanScheduleStep
        date="2000-01-01"
        activePick="custom"
        reminderTime="08:30"
        name="x"
        dateValid={false}
        onDateChange={vi.fn()}
        onReminderTimeChange={vi.fn()}
        onNameChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/today or a future date/i)).toBeInTheDocument();
  });
});
