import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => createMutate.mockReset());

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

  it("an appointment requires a start time and maps it to start_at", () => {
    render(<CreateTaskSheet open onOpenChange={() => {}} dealId="d-1" dealName="Acme Co" />);
    fireEvent.click(screen.getByRole("button", { name: "Appointment" }));
    // Missing start time blocks submit.
    fireEvent.click(screen.getByRole("button", { name: /^Create task$/i }));
    expect(createMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/Start time is required/i)).toBeInTheDocument();
    // Provide it → maps to start_at, not reminder_at.
    fireEvent.change(screen.getByLabelText(/Start time/i), { target: { value: "09:15" } });
    fireEvent.click(screen.getByRole("button", { name: /^Create task$/i }));
    const [input] = createMutate.mock.calls[0];
    expect(input.type).toBe("appointment");
    expect(input.startAt).toBeTruthy();
    expect(input.reminderAt).toBeNull();
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
});
