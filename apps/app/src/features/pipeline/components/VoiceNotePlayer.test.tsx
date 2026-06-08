import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const signedUrlFor = vi.fn();
vi.mock("@/features/path/lib/voiceNoteStorage", () => ({ signedUrlFor: (...a: unknown[]) => signedUrlFor(...a) }));
import { VoiceNotePlayer } from "./VoiceNotePlayer";

beforeEach(() => signedUrlFor.mockReset());

describe("VoiceNotePlayer", () => {
  it("fetches a signed url on play and renders an audio element", async () => {
    signedUrlFor.mockResolvedValueOnce("https://signed.example/a.webm");
    render(<VoiceNotePlayer path="user-1/a.webm" />);
    fireEvent.click(screen.getByRole("button", { name: /voice note|play/i }));
    await waitFor(() => expect(document.querySelector("audio")).toBeTruthy());
    expect(signedUrlFor).toHaveBeenCalledWith("user-1/a.webm");
  });
  it("shows a retry affordance when signing fails", async () => {
    signedUrlFor.mockRejectedValueOnce(new Error("nope"));
    render(<VoiceNotePlayer path="user-1/a.webm" />);
    fireEvent.click(screen.getByRole("button", { name: /voice note|play/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument());
  });
});
