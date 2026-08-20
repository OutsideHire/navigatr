import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PathSettings } from "./PathSettings";
import { allSubtypes } from "../lib/industrySelection";

const mutateAsync = vi.fn(async () => {});
const updateEndOfDayAsync = vi.fn(async () => {});
let endOfDayData: number | null = null;
vi.mock("../hooks/usePathPreferences", () => ({
  usePathPreferences: () => ({ data: { retail: allSubtypes("retail") }, isLoading: false }),
  useUpdateDefaultIndustries: () => ({ mutate: vi.fn(), mutateAsync, isPending: false }),
  usePathEndOfDayMinutes: () => ({ data: endOfDayData }),
  useUpdateEndOfDayMinutes: () => ({ mutateAsync: updateEndOfDayAsync, isPending: false }),
}));

beforeEach(() => {
  mutateAsync.mockClear();
  updateEndOfDayAsync.mockClear();
  endOfDayData = null;
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

  it("shows the 6:00 PM default in the End of day control when unset", () => {
    render(<PathSettings open onOpenChange={() => {}} />);
    expect(screen.getByText(/currently 6:00 PM/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/end of day/i)).toHaveValue("18:00");
  });

  it("reflects a saved override instead of the default", () => {
    endOfDayData = 15 * 60 + 30;
    render(<PathSettings open onOpenChange={() => {}} />);
    expect(screen.getByLabelText(/end of day/i)).toHaveValue("15:30");
    expect(screen.getByText(/currently 3:30 PM/i)).toBeInTheDocument();
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

  it("ignores a cleared/partial time value (never persists a bad value)", () => {
    render(<PathSettings open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText(/end of day/i), { target: { value: "" } });
    expect(updateEndOfDayAsync).not.toHaveBeenCalled();
  });
});
