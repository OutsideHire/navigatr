import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { CreateTaskSheet } from "./CreateTaskSheet";

const createMutate = vi.fn();
vi.mock("../hooks/useTaskMutations", () => ({
  useTaskMutations: () => ({
    createTask: { mutate: createMutate, isPending: false },
    completeTask: { mutate: vi.fn() },
    cancelTask: { mutate: vi.fn() },
    snoozeTask: { mutate: vi.fn() },
  }),
}));
const scheduleMutate = vi.fn();
vi.mock("@/features/appointments/useAppointments", () => ({
  useScheduleAppointment: () => ({ mutate: scheduleMutate, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Supabase powers the real useGeocodeDealCoords a drop-in triggers: it reads the
// deal's guard fields (from().select().eq().single()), invokes the geocoder,
// then writes lat/lng (from().update().eq()).
const singleMock = vi.fn();
const updateEqMock = vi.fn();
const updateMock = vi.fn(() => ({ eq: updateEqMock }));
const invokeMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ single: singleMock }) }),
      update: updateMock,
    }),
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

// A drop-in geocodes its deal, so every render needs a QueryClient.
function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: Providers });

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  createMutate.mockReset();
  scheduleMutate.mockReset();
  singleMock.mockReset();
  updateEqMock.mockReset().mockResolvedValue({ error: null });
  updateMock.mockClear();
  invokeMock.mockReset();
});

describe("CreateTaskSheet", () => {
  it("prefills the title from the deal name", () => {
    render(<CreateTaskSheet open onOpenChange={() => {}} dealId="d-1" dealName="Acme Co" />);
    expect(screen.getByLabelText(/Title/i)).toHaveValue("Acme Co");
  });

  it("creates a task with the chosen due date as target and default type call", () => {
    render(<CreateTaskSheet open onOpenChange={() => {}} dealId="d-1" dealName="Acme Co" />);
    fireEvent.change(screen.getByLabelText(/Due date/i), { target: { value: "2026-08-14" } });
    fireEvent.click(screen.getByRole("button", { name: /^Create task$/i }));
    expect(createMutate).toHaveBeenCalledTimes(1);
    const [input] = createMutate.mock.calls[0];
    expect(input).toMatchObject({
      type: "call",
      title: "Acme Co",
      dealId: "d-1",
      targetAt: "2026-08-14",
      originalTargetAt: "2026-08-14",
      dateSource: "interval",
    });
  });

  it("blocks submit with an empty title", () => {
    render(<CreateTaskSheet open onOpenChange={() => {}} dealId="d-1" dealName="" />);
    fireEvent.click(screen.getByRole("button", { name: /^Create task$/i }));
    expect(createMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/Title is required/i)).toBeInTheDocument();
  });

  it("a call's optional reminder time maps to reminder_at (not start_at); priority defaults to null", () => {
    render(<CreateTaskSheet open onOpenChange={() => {}} dealId="d-1" dealName="Acme Co" />);
    fireEvent.change(screen.getByLabelText(/Due date/i), { target: { value: "2026-08-14" } });
    fireEvent.change(screen.getByLabelText(/Reminder time/i), { target: { value: "14:30" } });
    fireEvent.click(screen.getByRole("button", { name: /^Create task$/i }));
    const [input] = createMutate.mock.calls[0];
    expect(input.priority).toBeNull();
    expect(input.startAt).toBeNull();
    expect(input.reminderAt).toBeTruthy();
    // Local wall-clock 14:30 → local minutes read back as 30.
    expect(new Date(input.reminderAt).getMinutes()).toBe(30);
  });

  it("an appointment books a REAL scheduled appointment (not a task), start+30min, syncing to calendar/Path", () => {
    // Regression (Robert): "Create task -> Appointment" must create a real
    // scheduled appointment (which syncs to Google Calendar via sync_appointment
    // and shows on Path via useMeetingStops), NOT a task. It routes to
    // useScheduleAppointment, never createTask.
    render(<CreateTaskSheet open onOpenChange={() => {}} dealId="d-1" dealName="Acme Co" />);
    fireEvent.click(screen.getByRole("button", { name: "Appointment" }));
    // Missing start time blocks submit.
    fireEvent.click(screen.getByRole("button", { name: /^Create task$/i }));
    expect(scheduleMutate).not.toHaveBeenCalled();
    expect(createMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/Start time is required/i)).toBeInTheDocument();
    // Provide it -> books the appointment via useScheduleAppointment.
    fireEvent.change(screen.getByLabelText(/Start time/i), { target: { value: "09:15" } });
    fireEvent.click(screen.getByRole("button", { name: /^Create task$/i }));
    // It did NOT create a task.
    expect(createMutate).not.toHaveBeenCalled();
    const [input] = scheduleMutate.mock.calls[0];
    expect(input.dealId).toBe("d-1");
    expect(input.title).toBeTruthy();
    expect(input.startAt).toBeTruthy();
    // Duration defaults to 30 min: end = start + 30 min.
    expect(new Date(input.endAt).getTime() - new Date(input.startAt).getTime()).toBe(30 * 60_000);
  });

  it("hides priority for drop-in and appointment; shows it for call", () => {
    render(<CreateTaskSheet open onOpenChange={() => {}} dealId="d-1" dealName="Acme Co" />);
    expect(screen.getByText("Priority")).toBeInTheDocument(); // default: call
    fireEvent.click(screen.getByRole("button", { name: "Drop-in" }));
    expect(screen.queryByText("Priority")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Appointment" }));
    expect(screen.queryByText("Priority")).not.toBeInTheDocument();
  });

  it("hides the time field entirely for a drop-in", () => {
    render(<CreateTaskSheet open onOpenChange={() => {}} dealId="d-1" dealName="Acme Co" />);
    fireEvent.click(screen.getByRole("button", { name: "Drop-in" }));
    expect(screen.queryByLabelText(/time/i)).not.toBeInTheDocument();
  });

  it("in standalone mode, requires a deal for a non-todo task", () => {
    render(<CreateTaskSheet open onOpenChange={() => {}} deals={[{ id: "d-1", companyName: "Acme" }]} />);
    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: "Follow up" } });
    fireEvent.click(screen.getByRole("button", { name: /^Create task$/i }));
    expect(createMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/Pick a deal/i)).toBeInTheDocument();
  });

  it("creating a drop-in on a deal with an address and no coords geocodes it and stamps lat/lng", async () => {
    singleMock.mockResolvedValueOnce({
      data: { address: "500 Elm St", lat: null, lng: null, place_id: null },
      error: null,
    });
    invokeMock.mockResolvedValueOnce({ data: { result: { lat: 1.1, lng: 2.2 } } });

    render(<CreateTaskSheet open onOpenChange={() => {}} dealId="d-1" dealName="Acme Co" />);
    fireEvent.click(screen.getByRole("button", { name: "Drop-in" }));
    fireEvent.click(screen.getByRole("button", { name: /^Create task$/i }));

    // The drop-in task is still created.
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0][0]).toMatchObject({ type: "drop_in", dealId: "d-1" });

    // And the deal is geocoded + stamped so the drop-in becomes routable.
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("geocode", { body: { query: "500 Elm St" } }),
    );
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ lat: 1.1, lng: 2.2 }));
    expect(updateEqMock).toHaveBeenCalledWith("id", "d-1");
  });

  it("creating a drop-in on a deal that already has coords does NOT call the geocoder", async () => {
    singleMock.mockResolvedValueOnce({
      data: { address: "500 Elm St", lat: 9.9, lng: 8.8, place_id: null },
      error: null,
    });

    render(<CreateTaskSheet open onOpenChange={() => {}} dealId="d-2" dealName="Located Co" />);
    fireEvent.click(screen.getByRole("button", { name: "Drop-in" }));
    fireEvent.click(screen.getByRole("button", { name: /^Create task$/i }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    // Guard reads the deal row, sees coords, and never invokes the geocoder.
    await waitFor(() => expect(singleMock).toHaveBeenCalled());
    expect(invokeMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("creating a call (not a drop-in) never geocodes the deal", async () => {
    render(<CreateTaskSheet open onOpenChange={() => {}} dealId="d-3" dealName="Acme Co" />);
    // Default type is "call".
    fireEvent.click(screen.getByRole("button", { name: /^Create task$/i }));
    expect(createMutate).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(singleMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
