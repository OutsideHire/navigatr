import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ValueBandsSection } from "./SettingsPage";

const mutateAsync = vi.fn(() => Promise.resolve());
let orgData: { valueBandLowCents: number | null; valueBandHighCents: number | null } | undefined;
let isPending = false;

vi.mock("@/features/auth/useOrganization", () => ({
  useOrganization: () => ({ data: orgData }),
}));
vi.mock("@/features/settings/hooks/useUpdateOrgValueBands", () => ({
  useUpdateOrgValueBands: () => ({ mutateAsync, isPending }),
}));
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m), success: (m: string) => toastSuccess(m) } }));

beforeEach(() => {
  mutateAsync.mockClear();
  toastError.mockClear();
  toastSuccess.mockClear();
  isPending = false;
  orgData = { valueBandLowCents: null, valueBandHighCents: null };
});

function lowInput() { return screen.getByLabelText(/lower threshold/i); }
function highInput() { return screen.getByLabelText(/upper threshold/i); }

describe("ValueBandsSection", () => {
  it("seeds inputs from stored cents and previews the resulting bands", () => {
    orgData = { valueBandLowCents: 50_000_00, valueBandHighCents: 250_000_00 };
    render(<ValueBandsSection />);
    expect(lowInput()).toHaveValue(50000);
    expect(highInput()).toHaveValue(250000);
    expect(screen.getByText("< $50K · $50K-$250K · > $250K")).toBeInTheDocument();
  });

  it("shows the default bands in the preview when unset", () => {
    render(<ValueBandsSection />);
    expect(screen.getByText("< $25K · $25K-$100K · > $100K")).toBeInTheDocument();
  });

  it("saves the thresholds as cents", async () => {
    render(<ValueBandsSection />);
    fireEvent.change(lowInput(), { target: { value: "30000" } });
    fireEvent.change(highInput(), { target: { value: "150000" } });
    fireEvent.click(screen.getByRole("button", { name: /save bands/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ lowCents: 30_000_00, highCents: 150_000_00 }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("blocks saving when the upper threshold is not greater than the lower", () => {
    render(<ValueBandsSection />);
    fireEvent.change(lowInput(), { target: { value: "100000" } });
    fireEvent.change(highInput(), { target: { value: "100000" } });
    // Save is disabled for an invalid pair.
    expect(screen.getByRole("button", { name: /save bands/i })).toBeDisabled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("resets to defaults with a null/null payload", async () => {
    orgData = { valueBandLowCents: 50_000_00, valueBandHighCents: 250_000_00 };
    render(<ValueBandsSection />);
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ lowCents: null, highCents: null }),
    );
  });
});
