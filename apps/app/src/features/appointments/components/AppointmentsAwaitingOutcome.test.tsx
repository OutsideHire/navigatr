import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppointmentsAwaitingOutcome, relativeTime } from "./AppointmentsAwaitingOutcome";

let items: Array<{
  id: string;
  dealId: string;
  companyName: string;
  title: string;
  startAt: string;
  endAt: string;
  hasFutureAppointment: boolean;
}>;
vi.mock("../hooks/useAppointmentsAwaitingOutcome", () => ({
  useAppointmentsAwaitingOutcome: () => ({ data: items }),
  APPOINTMENTS_AWAITING_OUTCOME_QUERY_KEY: (userId: string | undefined) => [
    "appointments",
    "awaiting-outcome",
    userId ?? "anon",
  ],
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));
// Stub the heavy sheet so this component's test stays focused on the card.
vi.mock("./AppointmentOutcomeSheet", () => ({
  AppointmentOutcomeSheet: (p: {
    open: boolean;
    appointmentId: string;
    dealId: string;
    merchantName?: string;
    hasFutureAppointment: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    p.open ? (
      <div data-testid="outcome-sheet">
        {`${p.appointmentId}:${p.dealId}:${p.merchantName}:${p.hasFutureAppointment}`}
        <button onClick={() => p.onOpenChange(false)}>close-sheet</button>
      </div>
    ) : null,
}));

function wrap(ui: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  items = [
    {
      id: "a1",
      dealId: "d1",
      companyName: "Acme Co",
      title: "Site visit",
      startAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      endAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      hasFutureAppointment: false,
    },
  ];
});

describe("AppointmentsAwaitingOutcome", () => {
  it("lists each awaiting-outcome appointment with a Log outcome action", () => {
    wrap(<AppointmentsAwaitingOutcome />);
    expect(screen.getByText(/appointments to log \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText("Acme Co")).toBeInTheDocument();
    expect(screen.getByText("Site visit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log outcome/i })).toBeInTheDocument();
  });

  it("opens AppointmentOutcomeSheet with the right props for the tapped appointment", () => {
    wrap(<AppointmentsAwaitingOutcome />);
    fireEvent.click(screen.getByRole("button", { name: /log outcome/i }));
    expect(screen.getByTestId("outcome-sheet")).toHaveTextContent("a1:d1:Acme Co:false");
  });

  it("closes the sheet on onOpenChange(false)", () => {
    wrap(<AppointmentsAwaitingOutcome />);
    fireEvent.click(screen.getByRole("button", { name: /log outcome/i }));
    expect(screen.getByTestId("outcome-sheet")).toBeInTheDocument();
    fireEvent.click(screen.getByText("close-sheet"));
    expect(screen.queryByTestId("outcome-sheet")).not.toBeInTheDocument();
  });

  it("renders nothing when there is nothing awaiting an outcome", () => {
    items = [];
    const { container } = wrap(<AppointmentsAwaitingOutcome />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("relativeTime", () => {
  const base = new Date("2026-06-24T12:00:00.000Z");
  const ago = (ms: number) => new Date(base.getTime() - ms).toISOString();
  const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

  it("returns 'just now' under a minute", () => {
    expect(relativeTime(ago(30 * SEC), base)).toBe("just now");
  });
  it("floors to whole minutes under an hour", () => {
    expect(relativeTime(ago(59 * MIN), base)).toBe("59m ago");
  });
  it("floors to whole hours under a day (89m to 1h)", () => {
    expect(relativeTime(ago(89 * MIN), base)).toBe("1h ago");
    expect(relativeTime(ago(23 * HOUR), base)).toBe("23h ago");
  });
  it("floors to whole days at a day or more (47h to 1d)", () => {
    expect(relativeTime(ago(47 * HOUR), base)).toBe("1d ago");
    expect(relativeTime(ago(2 * DAY), base)).toBe("2d ago");
  });
});
