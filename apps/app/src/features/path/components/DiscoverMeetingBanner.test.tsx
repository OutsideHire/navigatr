import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiscoverMeetingBanner } from "./DiscoverMeetingBanner";

describe("DiscoverMeetingBanner", () => {
  const meeting = { id: "m", title: "Smith Insurance", start: "2026-07-15T17:00:00.000Z", loc: { lat: 40, lng: -74 } };
  it("shows the next meeting title, time, and minutes-until", () => {
    const now = new Date(Date.parse(meeting.start) - 90 * 60000).toISOString();
    render(<DiscoverMeetingBanner meeting={meeting} now={now} />);
    expect(screen.getByText(/Smith Insurance/)).toBeInTheDocument();
    expect(screen.getByText(/90 min/i)).toBeInTheDocument();
  });
  it("renders nothing when there is no meeting", () => {
    const { container } = render(<DiscoverMeetingBanner meeting={null} now="2026-07-15T09:00:00.000Z" />);
    expect(container).toBeEmptyDOMElement();
  });
});
