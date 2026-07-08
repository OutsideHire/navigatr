import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IntegrationsTab } from "./IntegrationsTab";
import type {
  CalendarProviderId,
  UseCalendarConnectionResult,
} from "@/features/integrations/useCalendarConnection";

// The tab renders one card per provider, each driven by
// useCalendarConnection(provider). The mock dispatches on the provider argument
// so each card gets its own status + connect/disconnect handlers.
const useCalendarConnection = vi.fn<(provider?: CalendarProviderId) => UseCalendarConnectionResult>();
vi.mock("@/features/integrations/useCalendarConnection", () => ({
  useCalendarConnection: (provider?: CalendarProviderId) => useCalendarConnection(provider),
}));

const googleConnect = vi.fn();
const googleDisconnect = vi.fn();
const microsoftConnect = vi.fn();
const microsoftDisconnect = vi.fn();

function stub(
  connect: () => void,
  disconnect: () => void,
  over: Partial<UseCalendarConnectionResult> = {},
): UseCalendarConnectionResult {
  return {
    status: "disconnected",
    isLoading: false,
    connect,
    disconnect,
    isDisconnecting: false,
    ...over,
  };
}

/** Wire the mock so each provider returns its own state. */
function setup(opts: {
  google?: Partial<UseCalendarConnectionResult>;
  microsoft?: Partial<UseCalendarConnectionResult>;
} = {}) {
  useCalendarConnection.mockImplementation((provider) =>
    provider === "microsoft"
      ? stub(microsoftConnect, microsoftDisconnect, opts.microsoft)
      : stub(googleConnect, googleDisconnect, opts.google),
  );
}

beforeEach(() => {
  googleConnect.mockReset();
  googleDisconnect.mockReset();
  microsoftConnect.mockReset();
  microsoftDisconnect.mockReset();
  useCalendarConnection.mockReset();
});

describe("IntegrationsTab", () => {
  it("renders both a Google Calendar card and an Outlook Calendar card", () => {
    setup();
    render(<IntegrationsTab />);
    expect(screen.getByText("Google Calendar")).toBeInTheDocument();
    expect(screen.getByText("Outlook Calendar")).toBeInTheDocument();
    // Both hooks are consulted, one per provider.
    expect(useCalendarConnection).toHaveBeenCalledWith("google");
    expect(useCalendarConnection).toHaveBeenCalledWith("microsoft");
  });

  it("Google card: disconnected shows explainer + Connect button that calls google connect()", () => {
    setup({ google: { status: "disconnected" } });
    render(<IntegrationsTab />);
    fireEvent.click(screen.getByRole("button", { name: /connect google calendar/i }));
    expect(googleConnect).toHaveBeenCalledTimes(1);
    expect(microsoftConnect).not.toHaveBeenCalled();
  });

  it("Outlook card: disconnected shows Connect button that calls microsoft connect()", () => {
    setup({ microsoft: { status: "disconnected" } });
    render(<IntegrationsTab />);
    fireEvent.click(screen.getByRole("button", { name: /connect outlook calendar/i }));
    expect(microsoftConnect).toHaveBeenCalledTimes(1);
    expect(googleConnect).not.toHaveBeenCalled();
  });

  it("Google card: pending shows a finishing-connection note", () => {
    setup({ google: { status: "pending" }, microsoft: { status: "disconnected" } });
    render(<IntegrationsTab />);
    expect(screen.getByText(/finishing connection/i)).toBeInTheDocument();
    // Outlook is still disconnected, so its Connect button remains.
    expect(
      screen.getByRole("button", { name: /connect outlook calendar/i }),
    ).toBeInTheDocument();
  });

  it("Outlook card: connected shows connected row + Disconnect that calls microsoft disconnect()", () => {
    setup({ google: { status: "disconnected" }, microsoft: { status: "connected" } });
    render(<IntegrationsTab />);
    expect(screen.getByText(/outlook calendar connected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(microsoftDisconnect).toHaveBeenCalledTimes(1);
    expect(googleDisconnect).not.toHaveBeenCalled();
  });

  it("Google card: connected shows connected row + Disconnect that calls google disconnect()", () => {
    setup({ google: { status: "connected" }, microsoft: { status: "disconnected" } });
    render(<IntegrationsTab />);
    expect(screen.getByText(/google calendar connected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(googleDisconnect).toHaveBeenCalledTimes(1);
    expect(microsoftDisconnect).not.toHaveBeenCalled();
  });

  it("shows a per-card loading note while a provider status is loading", () => {
    setup({ google: { isLoading: true }, microsoft: { status: "disconnected" } });
    render(<IntegrationsTab />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("scopes each card's controls to its own provider", () => {
    // Both connected: two Disconnect buttons, one per card. The Google card
    // renders first, so its Disconnect is the first button; clicking it must not
    // fire microsoft's disconnect.
    setup({ google: { status: "connected" }, microsoft: { status: "connected" } });
    render(<IntegrationsTab />);
    const disconnects = screen.getAllByRole("button", { name: /disconnect/i });
    expect(disconnects).toHaveLength(2);
    fireEvent.click(disconnects[0]);
    expect(googleDisconnect).toHaveBeenCalledTimes(1);
    expect(microsoftDisconnect).not.toHaveBeenCalled();
  });
});
