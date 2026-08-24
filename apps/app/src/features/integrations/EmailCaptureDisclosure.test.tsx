import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmailCaptureDisclosure } from "./EmailCaptureDisclosure";

describe("EmailCaptureDisclosure", () => {
  it("pre-connect: states what is captured and that nothing is logged without confirmation", () => {
    render(<EmailCaptureDisclosure connected={false} />);
    expect(screen.getByText(/this also turns on email logging/i)).toBeInTheDocument();
    const body = screen.getByText(/read the details of emails you send/i);
    expect(body).toHaveTextContent(/never read the message body or attachments/i);
    expect(body).toHaveTextContent(/nothing is logged until you confirm/i);
  });

  it("post-connect: reminds the rep logging is on and confirmation is per-email", () => {
    render(<EmailCaptureDisclosure connected />);
    expect(screen.getByText(/email logging is on/i)).toBeInTheDocument();
    const body = screen.getByText(/suggests logging the emails you send/i);
    expect(body).toHaveTextContent(/confirm each one/i);
    expect(body).toHaveTextContent(/never the message body or attachments/i);
  });
});
