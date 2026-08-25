import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CheckYourEmailNotice } from "./CheckYourEmailNotice";

const resendMock = vi.fn();
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { resendSignupEmail: typeof resendMock }) => unknown) =>
    selector({ resendSignupEmail: resendMock }),
}));

beforeEach(() => resendMock.mockReset());

describe("CheckYourEmailNotice", () => {
  it("shows the target email and a resend affordance", () => {
    render(<CheckYourEmailNotice email="rep@acme.test" />);
    expect(screen.getByText("rep@acme.test")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resend email/i })).toBeInTheDocument();
  });

  it("resends the confirmation email and confirms + cools down on success", async () => {
    resendMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<CheckYourEmailNotice email="rep@acme.test" />);

    await user.click(screen.getByRole("button", { name: /resend email/i }));

    expect(resendMock).toHaveBeenCalledWith("rep@acme.test");
    expect(await screen.findByText(/sent\. check your inbox/i)).toBeInTheDocument();
    // Button is now cooling down (disabled with a countdown label).
    expect(screen.getByRole("button", { name: /resend email \(\d+s\)/i })).toBeDisabled();
  });

});
