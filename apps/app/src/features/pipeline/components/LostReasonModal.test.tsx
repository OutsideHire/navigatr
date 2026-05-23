// Tests for LostReasonModal:
//   1. Renders all 7 reason options.
//   2. Save is disabled until a category is selected.
//   3. Submitting calls onSubmit with the chosen category + notes.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LostReasonModal } from "./LostReasonModal";
import { LOST_REASON_LABEL } from "../mockData";

const noop = () => {};

function renderModal(
  props: Partial<React.ComponentProps<typeof LostReasonModal>> = {},
) {
  return render(
    <LostReasonModal
      open={true}
      onOpenChange={noop}
      onSubmit={async () => {}}
      {...props}
    />,
  );
}

describe("LostReasonModal", () => {
  it("renders all 7 reason options", () => {
    renderModal();
    const labels = Object.values(LOST_REASON_LABEL);
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // 7 radio items
    expect(screen.getAllByRole("radio")).toHaveLength(7);
  });

  it("Save button is disabled until a category is selected", () => {
    renderModal();
    const saveBtn = screen.getByRole("button", { name: /save/i });
    expect(saveBtn).toBeDisabled();

    // Pick a reason — button should become enabled
    const firstRadio = screen.getAllByRole("radio")[0];
    fireEvent.click(firstRadio);
    expect(saveBtn).not.toBeDisabled();
  });

  it("calls onSubmit with the picked category and notes on Save", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    renderModal({ onSubmit, onOpenChange });

    // Select "Price / budget" (key: "price")
    await user.click(screen.getByLabelText("Price / budget"));

    // Fill in notes
    const textarea = screen.getByPlaceholderText(/add context/i);
    await user.type(textarea, "Too high");

    // Click Save
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("price", "Too high");
    });
  });
});
