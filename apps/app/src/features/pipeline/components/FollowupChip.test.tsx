import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FollowupChip } from "./FollowupChip";

describe("FollowupChip", () => {
  it("renders a labeled 'Follow up: {date}' indicator when a date is set", () => {
    // Noon-UTC stored calendar date. formatCalendarDate reads it back in UTC.
    render(<FollowupChip date="2026-08-14T12:00:00.000Z" />);
    expect(screen.getByText(/Follow up:/i)).toBeInTheDocument();
    expect(screen.getByText("Aug 14")).toBeInTheDocument();
  });

  it("renders nothing when the follow-up date is null", () => {
    const { container } = render(<FollowupChip date={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Follow up:/i)).not.toBeInTheDocument();
  });

  it("renders nothing when the follow-up date is undefined", () => {
    const { container } = render(<FollowupChip date={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
