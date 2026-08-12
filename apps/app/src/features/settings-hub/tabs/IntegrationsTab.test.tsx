import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
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

// The primary-calendar picker (rendered only when both calendars are connected)
// reads the current choice from the profile and writes it via supabase.
const useProfile = vi.fn<() => { data: { primary_calendar_provider: CalendarProviderId | null } | undefined }>();
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => useProfile(),
}));

vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));

// The picker writes through the set_primary_calendar_provider RPC rather than a
// direct table UPDATE: 20260812000001 revokes UPDATE on profiles from
// `authenticated`, so a .from("profiles").update(...) here would pass in test
// and be refused in production.
const rpc = vi.fn<(fn: string, args: unknown) => Promise<{ error: null }>>(() =>
  Promise.resolve({ error: null }),
);
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => rpc(fn, args),
  },
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

/** Render inside a QueryClientProvider (the primary picker uses useMutation). */
function renderTab(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  googleConnect.mockReset();
  googleDisconnect.mockReset();
  microsoftConnect.mockReset();
  microsoftDisconnect.mockReset();
  useCalendarConnection.mockReset();
  rpc.mockClear();
  useProfile.mockReset();
  useProfile.mockReturnValue({ data: { primary_calendar_provider: null } });
});

describe("IntegrationsTab", () => {
  it("renders both a Google Calendar card and an Outlook Calendar card", () => {
    setup();
    renderTab(<IntegrationsTab />);
    expect(screen.getByText("Google Calendar")).toBeInTheDocument();
    expect(screen.getByText("Outlook Calendar")).toBeInTheDocument();
    // Both hooks are consulted, one per provider.
    expect(useCalendarConnection).toHaveBeenCalledWith("google");
    expect(useCalendarConnection).toHaveBeenCalledWith("microsoft");
  });

  it("Google card: disconnected shows explainer + Connect button that calls google connect()", () => {
    setup({ google: { status: "disconnected" } });
    renderTab(<IntegrationsTab />);
    fireEvent.click(screen.getByRole("button", { name: /connect google calendar/i }));
    expect(googleConnect).toHaveBeenCalledTimes(1);
    expect(microsoftConnect).not.toHaveBeenCalled();
  });

  it("Outlook card: disconnected shows Connect button that calls microsoft connect()", () => {
    setup({ microsoft: { status: "disconnected" } });
    renderTab(<IntegrationsTab />);
    fireEvent.click(screen.getByRole("button", { name: /connect outlook calendar/i }));
    expect(microsoftConnect).toHaveBeenCalledTimes(1);
    expect(googleConnect).not.toHaveBeenCalled();
  });

  it("Google card: pending shows a finishing-connection note", () => {
    setup({ google: { status: "pending" }, microsoft: { status: "disconnected" } });
    renderTab(<IntegrationsTab />);
    expect(screen.getByText(/finishing connection/i)).toBeInTheDocument();
    // Outlook is still disconnected, so its Connect button remains.
    expect(
      screen.getByRole("button", { name: /connect outlook calendar/i }),
    ).toBeInTheDocument();
  });

  it("Outlook card: connected shows connected row + Disconnect that calls microsoft disconnect()", () => {
    setup({ google: { status: "disconnected" }, microsoft: { status: "connected" } });
    renderTab(<IntegrationsTab />);
    expect(screen.getByText(/outlook calendar connected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(microsoftDisconnect).toHaveBeenCalledTimes(1);
    expect(googleDisconnect).not.toHaveBeenCalled();
  });

  it("Google card: connected shows connected row + Disconnect that calls google disconnect()", () => {
    setup({ google: { status: "connected" }, microsoft: { status: "disconnected" } });
    renderTab(<IntegrationsTab />);
    expect(screen.getByText(/google calendar connected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(googleDisconnect).toHaveBeenCalledTimes(1);
    expect(microsoftDisconnect).not.toHaveBeenCalled();
  });

  it("shows a per-card loading note while a provider status is loading", () => {
    setup({ google: { isLoading: true }, microsoft: { status: "disconnected" } });
    renderTab(<IntegrationsTab />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("scopes each card's controls to its own provider", () => {
    // Both connected: two Disconnect buttons, one per card. The Google card
    // renders first, so its Disconnect is the first button; clicking it must not
    // fire microsoft's disconnect.
    setup({ google: { status: "connected" }, microsoft: { status: "connected" } });
    renderTab(<IntegrationsTab />);
    const disconnects = screen.getAllByRole("button", { name: /disconnect/i });
    expect(disconnects).toHaveLength(2);
    fireEvent.click(disconnects[0]);
    expect(googleDisconnect).toHaveBeenCalledTimes(1);
    expect(microsoftDisconnect).not.toHaveBeenCalled();
  });

  it("shows the Primary calendar picker only when BOTH providers are connected", () => {
    // Only one connected → no picker.
    setup({ google: { status: "connected" }, microsoft: { status: "disconnected" } });
    const { unmount } = renderTab(<IntegrationsTab />);
    expect(screen.queryByText(/primary calendar/i)).not.toBeInTheDocument();
    unmount();

    // Both connected → picker appears with a button per provider.
    setup({ google: { status: "connected" }, microsoft: { status: "connected" } });
    renderTab(<IntegrationsTab />);
    expect(screen.getByText(/primary calendar/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /google calendar/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /outlook calendar/i })).toBeInTheDocument();
  });

  it("writes the chosen primary provider and reflects the current selection", async () => {
    setup({ google: { status: "connected" }, microsoft: { status: "connected" } });
    useProfile.mockReturnValue({ data: { primary_calendar_provider: "google" } });
    renderTab(<IntegrationsTab />);

    // The currently-selected provider is marked pressed.
    const googleBtn = screen.getByRole("button", { name: /google calendar/i });
    const outlookBtn = screen.getByRole("button", { name: /outlook calendar/i });
    expect(googleBtn).toHaveAttribute("aria-pressed", "true");
    expect(outlookBtn).toHaveAttribute("aria-pressed", "false");

    // Choosing Outlook writes primary_calendar_provider = microsoft, via the RPC.
    fireEvent.click(outlookBtn);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("set_primary_calendar_provider", {
        p_provider: "microsoft",
      }),
    );
  });

  it("never writes to the profiles table directly", async () => {
    // Regression guard for 20260812000001: UPDATE on profiles is revoked from
    // `authenticated`, so any direct table write from this tab would pass CI and
    // fail silently in production. The supabase mock exposes only `rpc`, so a
    // reintroduced .from("profiles").update(...) throws here instead.
    setup({ google: { status: "connected" }, microsoft: { status: "connected" } });
    useProfile.mockReturnValue({ data: { primary_calendar_provider: "google" } });
    renderTab(<IntegrationsTab />);

    fireEvent.click(screen.getByRole("button", { name: /outlook calendar/i }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith("set_primary_calendar_provider", {
      p_provider: "microsoft",
    });
  });
});
