import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StageUpdateModal } from "./StageUpdateModal";
import { MOCK_DEALS, type Deal } from "../mockData";

function deal(over: Partial<Deal> = {}): Deal { return { ...MOCK_DEALS[0], ...over }; }

describe("StageUpdateModal", () => {
  it("renders the target stage title and its default probability", () => {
    render(<StageUpdateModal open deal={deal({ companyName: "Acme", stage: "new" })} toStage="contacted" onOpenChange={() => {}} onConfirm={() => {}} />);
    expect(screen.getByText(/move acme to contacted/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/probability/i)).toHaveValue(35);
  });
  it("confirm passes the (possibly edited) probability + note", () => {
    const onConfirm = vi.fn();
    render(<StageUpdateModal open deal={deal({ stage: "new" })} toStage="qualified" onOpenChange={() => {}} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText(/probability/i), { target: { value: "70" } });
    fireEvent.change(screen.getByPlaceholderText(/what changed/i), { target: { value: "Demo booked" } });
    fireEvent.click(screen.getByRole("button", { name: /move to qualified/i }));
    expect(onConfirm).toHaveBeenCalledWith(70, "Demo booked");
  });
  it("renders nothing when deal or toStage is null", () => {
    const { container } = render(<StageUpdateModal open deal={null} toStage={null} onOpenChange={() => {}} onConfirm={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("disables confirm while busy", () => {
    render(<StageUpdateModal open busy deal={deal({ stage: "new" })} toStage="contacted" onOpenChange={() => {}} onConfirm={() => {}} />);
    expect(screen.getByRole("button", { name: /move to contacted/i })).toBeDisabled();
  });
});
