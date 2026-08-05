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
});
