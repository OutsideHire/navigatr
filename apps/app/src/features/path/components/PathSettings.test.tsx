import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PathSettings } from "./PathSettings";
import { allSubtypes } from "../lib/industrySelection";

const mutateAsync = vi.fn(async () => {});
vi.mock("../hooks/usePathPreferences", () => ({
  usePathPreferences: () => ({ data: { retail: allSubtypes("retail") }, isLoading: false }),
  useUpdateDefaultIndustries: () => ({ mutate: vi.fn(), mutateAsync, isPending: false }),
}));

beforeEach(() => mutateAsync.mockClear());

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
});
