import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PhoneWithClickToCall } from "./PhoneWithClickToCall";

describe("PhoneWithClickToCall", () => {
  it("formats a valid US number and enables the call button with its e164", () => {
    const onCallClick = vi.fn();
    render(<PhoneWithClickToCall phoneNumber="+15125550100" onCallClick={onCallClick} />);
    expect(screen.getByText("(512) 555-0100")).toBeInTheDocument();
    const call = screen.getByRole("button", { name: /call \(512\) 555-0100/i });
    expect(call).not.toBeDisabled();
    fireEvent.click(call);
    expect(onCallClick).toHaveBeenCalledWith("+15125550100");
  });

  it("shows a non-US-but-dialable number as-is with an enabled call button (no 'Invalid number')", () => {
    const onCallClick = vi.fn();
    render(<PhoneWithClickToCall phoneNumber="(02) 8850 1565" onCallClick={onCallClick} />);
    // The raw number is shown, NOT the dead "Invalid number" text.
    expect(screen.getByText("(02) 8850 1565")).toBeInTheDocument();
    expect(screen.queryByText("Invalid number")).not.toBeInTheDocument();
    const call = screen.getByRole("button", { name: /call \(02\) 8850 1565/i });
    expect(call).not.toBeDisabled();
    fireEvent.click(call);
    expect(onCallClick).toHaveBeenCalledWith("0288501565");
  });

  it("keeps the disabled 'Invalid number' state for junk / too-short input", () => {
    const onCallClick = vi.fn();
    render(<PhoneWithClickToCall phoneNumber="123" onCallClick={onCallClick} />);
    expect(screen.getByText("Invalid number")).toBeInTheDocument();
    const call = screen.getByRole("button", { name: /invalid phone number/i });
    expect(call).toBeDisabled();
    fireEvent.click(call);
    expect(onCallClick).not.toHaveBeenCalled();
  });
});
