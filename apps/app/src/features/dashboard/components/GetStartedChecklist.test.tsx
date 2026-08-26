import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GetStartedChecklist } from "./GetStartedChecklist";
import type { OnboardingStep } from "../hooks/useOnboardingProgress";

const STEPS: OnboardingStep[] = [
  { key: "workspace", label: "Create your workspace", done: true },
  { key: "invite", label: "Invite your team", done: false, ctaTo: "/welcome", emphasized: true },
  { key: "teammate", label: "Your first teammate joins", done: false },
  { key: "activity", label: "See your team in action", done: false, ctaTo: "/pipeline" },
];

function renderChecklist(over: Partial<React.ComponentProps<typeof GetStartedChecklist>> = {}) {
  const props = {
    steps: STEPS,
    collapsed: false,
    onToggleCollapse: vi.fn(),
    onStepCta: vi.fn(),
    ...over,
  };
  render(<GetStartedChecklist {...props} />);
  return props;
}

describe("GetStartedChecklist", () => {
  it("shows progress and each step's done/undone state", () => {
    renderChecklist();
    expect(screen.getByText("1 of 4 done")).toBeInTheDocument();
    // Workspace is done, invite is not.
    const items = screen.getAllByRole("listitem");
    const workspaceRow = items.find((el) => el.textContent?.includes("Create your workspace"))!;
    const inviteRow = items.find((el) => el.textContent?.includes("Invite your team"))!;
    expect(within(workspaceRow).getByLabelText("Done")).toBeInTheDocument();
    expect(within(inviteRow).getByLabelText("To do")).toBeInTheDocument();
  });

  it("fires the CTA for an undone actionable step", async () => {
    const user = userEvent.setup();
    const { onStepCta } = renderChecklist();
    await user.click(screen.getByRole("button", { name: /invite your team/i }));
    expect(onStepCta).toHaveBeenCalledWith("/welcome");
  });

  it("hides the steps when collapsed but keeps a toggle to reopen", async () => {
    const user = userEvent.setup();
    const { onToggleCollapse } = renderChecklist({ collapsed: true });
    expect(screen.queryByText("Your first teammate joins")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /expand get-started checklist/i }));
    expect(onToggleCollapse).toHaveBeenCalled();
  });

  it("renders nothing once every step is done (auto-retire)", () => {
    const { container } = render(
      <GetStartedChecklist
        steps={STEPS.map((s) => ({ ...s, done: true }))}
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onStepCta={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
