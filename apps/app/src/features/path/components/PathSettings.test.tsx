import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PathSettings } from "./PathSettings";
import { allSubtypes } from "../lib/industrySelection";

const update = vi.fn();
vi.mock("../hooks/usePathPreferences", () => ({
  usePathPreferences: () => ({ data: { retail: allSubtypes("retail") }, isLoading: false }),
  useUpdateDefaultIndustries: () => ({ mutate: update, mutateAsync: vi.fn(async () => {}), isPending: false }),
}));

beforeEach(() => update.mockClear());

describe("PathSettings", () => {
  it("renders the Default industries section with the saved selection when open", () => {
    render(<PathSettings open onOpenChange={() => {}} />);
    expect(screen.getByText(/default industries/i)).toBeInTheDocument();
    expect(screen.getByText(/retail/i)).toBeInTheDocument();
  });

  it("Save persists the default industries", () => {
    render(<PathSettings open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(update).toHaveBeenCalled();
  });
});
