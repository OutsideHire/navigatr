import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IntegrationsTab } from "./IntegrationsTab";
import type { UseCalendarConnectionResult } from "@/features/integrations/useCalendarConnection";

const useCalendarConnection = vi.fn<() => UseCalendarConnectionResult>();
vi.mock("@/features/integrations/useCalendarConnection", () => ({
  useCalendarConnection: () => useCalendarConnection(),
}));

const connect = vi.fn();
const disconnect = vi.fn();

function stub(over: Partial<UseCalendarConnectionResult> = {}): UseCalendarConnectionResult {
  return {
    status: "disconnected",
    isLoading: false,
    connect,
    disconnect,
    isDisconnecting: false,
    ...over,
  };
}

beforeEach(() => {
  connect.mockReset();
  disconnect.mockReset();
  useCalendarConnection.mockReset();
});

describe("IntegrationsTab", () => {
  it("disconnected: shows explainer + Connect button that calls connect()", () => {
    useCalendarConnection.mockReturnValue(stub({ status: "disconnected" }));
    render(<IntegrationsTab />);
    expect(screen.getByText(/builds around your meetings/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /connect google calendar/i }));
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("pending: shows a finishing-connection note", () => {
    useCalendarConnection.mockReturnValue(stub({ status: "pending" }));
    render(<IntegrationsTab />);
    expect(screen.getByText(/finishing connection/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connect google calendar/i })).toBeNull();
  });

  it("connected: shows connected row + Disconnect button that calls disconnect()", () => {
    useCalendarConnection.mockReturnValue(stub({ status: "connected" }));
    render(<IntegrationsTab />);
    expect(screen.getByText(/google calendar connected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("loading: shows a loading note", () => {
    useCalendarConnection.mockReturnValue(stub({ isLoading: true }));
    render(<IntegrationsTab />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
