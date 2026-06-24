import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DealCallButton } from "./DealCallButton";

const recordDialMock = vi.fn();
vi.mock("../hooks/useRecordDial", () => ({
  useRecordDial: () => ({ mutate: recordDialMock }),
}));

const assignMock = vi.fn();

function wrap(ui: ReactNode) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  recordDialMock.mockClear();
  assignMock.mockClear();
  Object.defineProperty(window, "location", {
    value: { assign: assignMock },
    writable: true,
  });
});

describe("DealCallButton", () => {
  it("records the dial and launches the call when tapped", () => {
    wrap(<DealCallButton dealId="deal-1" phoneNumber="+15551234567" />);
    fireEvent.click(screen.getByRole("button", { name: /call/i }));
    expect(recordDialMock).toHaveBeenCalledWith({ dealId: "deal-1", phoneNumber: "+15551234567" });
    expect(assignMock).toHaveBeenCalledWith("tel:+15551234567");
  });
});
