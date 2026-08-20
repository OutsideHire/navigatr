import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PathSettings } from "./PathSettings";
import { allSubtypes } from "../lib/industrySelection";

const mutateAsync = vi.fn(async () => {});
const updateStartOfDayAsync = vi.fn(async () => {});
const updateEndOfDayAsync = vi.fn(async () => {});
const updateTimezoneAsync = vi.fn(async () => {});
let startOfDayData: number | null = null;
let endOfDayData: number | null = null;
let timezoneData: string | null = null;
vi.mock("../hooks/usePathPreferences", () => ({
  usePathPreferences: () => ({ data: { retail: allSubtypes("retail") }, isLoading: false }),
  useUpdateDefaultIndustries: () => ({ mutate: vi.fn(), mutateAsync, isPending: false }),
  usePathStartOfDayMinutes: () => ({ data: startOfDayData }),
  useUpdateStartOfDayMinutes: () => ({ mutateAsync: updateStartOfDayAsync, isPending: false }),
  usePathEndOfDayMinutes: () => ({ data: endOfDayData }),
  useUpdateEndOfDayMinutes: () => ({ mutateAsync: updateEndOfDayAsync, isPending: false }),
  usePathTimezone: () => ({ data: timezoneData }),
  useUpdateTimezone: () => ({ mutateAsync: updateTimezoneAsync, isPending: false }),
}));

beforeEach(() => {
  mutateAsync.mockClear();
  updateStartOfDayAsync.mockClear();
  updateEndOfDayAsync.mockClear();
  updateTimezoneAsync.mockClear();
  startOfDayData = null;
  endOfDayData = null;
  timezoneData = null;
});

describe("PathSettings", () => {
  it("renders the Default industries section with the saved selection when open", () => {
    render(<PathSettings open onOpenChange={() => {}} />);
    expect(screen.getByText(/default industries/i)).toBeInTheDocument();
    expect(screen.getByText(/retail/i)).toBeInTheDocument();
  });

  it("Save persists then closes the sheet", async () => {
    const onOpenChange = vi.fn();
    render(<PathSettings open onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the 8:00 AM to 6:00 PM defaults in the workday controls when unset", () => {
    render(<PathSettings open onOpenChange={() => {}} />);
    expect(screen.getByText(/currently 8:00 AM to 6:00 PM/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/start of day/i)).toHaveValue("08:00");
    expect(screen.getByLabelText(/end of day/i)).toHaveValue("18:00");
  });

  it("reflects saved start/end overrides instead of the defaults", () => {
    startOfDayData = 9 * 60 + 30;
    endOfDayData = 15 * 60 + 30;
    render(<PathSettings open onOpenChange={() => {}} />);
    expect(screen.getByLabelText(/start of day/i)).toHaveValue("09:30");
    expect(screen.getByLabelText(/end of day/i)).toHaveValue("15:30");
    expect(screen.getByText(/currently 9:30 AM to 3:30 PM/i)).toBeInTheDocument();
  });

  it("persists a new start-of-day time on change", async () => {
    render(<PathSettings open onOpenChange={() => {}} />);
    // 7:00 AM (420), distinct from the 8:00 default and a valid pair with 6:00 PM.
    fireEvent.change(screen.getByLabelText(/start of day/i), { target: { value: "07:00" } });
    await waitFor(() => expect(updateStartOfDayAsync).toHaveBeenCalledWith(7 * 60));
  });

  it("rejects a start that is not at least an hour before the end (never persists)", () => {
    endOfDayData = 18 * 60; // 6:00 PM
    render(<PathSettings open onOpenChange={() => {}} />);
    // 5:30 PM start vs 6:00 PM end = 30 min window -> rejected.
    fireEvent.change(screen.getByLabelText(/start of day/i), { target: { value: "17:30" } });
    expect(updateStartOfDayAsync).not.toHaveBeenCalled();
  });

  it("rejects an end that is not at least an hour after the start (never persists)", () => {
    startOfDayData = 8 * 60; // 8:00 AM
    render(<PathSettings open onOpenChange={() => {}} />);
    // 8:30 AM end vs 8:00 AM start = 30 min window -> rejected.
    fireEvent.change(screen.getByLabelText(/end of day/i), { target: { value: "08:30" } });
    expect(updateEndOfDayAsync).not.toHaveBeenCalled();
  });

  it("persists a new end-of-day time on change without closing the sheet", async () => {
    const onOpenChange = vi.fn();
    render(<PathSettings open onOpenChange={onOpenChange} />);
    // Type a value distinct from the 6:00 PM default so the controlled input
    // registers a real change (16:30 = 990 minutes from midnight).
    fireEvent.change(screen.getByLabelText(/end of day/i), { target: { value: "16:30" } });
    await waitFor(() => expect(updateEndOfDayAsync).toHaveBeenCalledWith(16 * 60 + 30));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("shows the stored timezone and lets the rep change it", async () => {
    timezoneData = "America/Chicago";
    render(<PathSettings open onOpenChange={() => {}} />);
    expect(screen.getByText(/shown in Central Time \(America\/Chicago\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/time zone/i)).toHaveValue("America/Chicago");
    fireEvent.change(screen.getByLabelText(/time zone/i), { target: { value: "America/Los_Angeles" } });
    await waitFor(() => expect(updateTimezoneAsync).toHaveBeenCalledWith("America/Los_Angeles"));
  });

  it("ignores a cleared/partial time value (never persists a bad value)", () => {
    render(<PathSettings open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText(/end of day/i), { target: { value: "" } });
    expect(updateEndOfDayAsync).not.toHaveBeenCalled();
  });
});
