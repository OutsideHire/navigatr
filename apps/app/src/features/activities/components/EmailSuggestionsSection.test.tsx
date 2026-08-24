import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  EmailSuggestionsSection,
  EMAIL_CAPTURE_UI_ENABLED,
} from "./EmailSuggestionsSection";
import type { EmailSuggestionView } from "../lib/emailSuggestions";

let suggestions: EmailSuggestionView[];
vi.mock("../hooks/useEmailSuggestions", () => ({
  useEmailSuggestions: () => ({ data: suggestions }),
  EMAIL_SUGGESTIONS_QUERY_KEY: (u: string | undefined) => ["email-suggestions", u ?? "anon"],
}));

const confirmMutate = vi.fn();
const dismissMutate = vi.fn();
vi.mock("../hooks/useEmailSuggestionActions", () => ({
  useConfirmEmailSuggestion: () => ({ mutate: confirmMutate, isPending: false, variables: undefined }),
  useDismissEmailSuggestion: () => ({ mutate: dismissMutate, isPending: false, variables: undefined }),
}));

function wrap(ui: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

function view(over: Partial<EmailSuggestionView> & { id: string }): EmailSuggestionView {
  return {
    subject: "Proposal follow-up",
    recipientSummary: "jane@acme.com",
    sentAt: new Date().toISOString(),
    dealId: "d1",
    companyName: "Acme Co",
    deepLinkUrl: null,
    ...over,
  };
}

beforeEach(() => {
  suggestions = [view({ id: "e1" })];
  confirmMutate.mockReset();
  dismissMutate.mockReset();
});

describe("EmailSuggestionsSection", () => {
  it("is dark by default (the flag is off unless VITE_EMAIL_CAPTURE=true)", () => {
    expect(EMAIL_CAPTURE_UI_ENABLED).toBe(false);
  });

  it("renders nothing when disabled, even with suggestions present", () => {
    const { container } = wrap(<EmailSuggestionsSection enabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each suggestion with company, subject and Confirm/Dismiss when enabled", () => {
    wrap(<EmailSuggestionsSection enabled />);
    expect(screen.getByText(/suggested from email \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText("Acme Co")).toBeInTheDocument();
    expect(screen.getByText(/proposal follow-up · to jane@acme\.com/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^confirm$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^dismiss$/i })).toBeInTheDocument();
  });

  it("links the subject to the sent email when a deep link is present", () => {
    suggestions = [view({ id: "e1", deepLinkUrl: "https://outlook.example/1" })];
    wrap(<EmailSuggestionsSection enabled />);
    const link = screen.getByRole("link", { name: /proposal follow-up/i });
    expect(link).toHaveAttribute("href", "https://outlook.example/1");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders the subject as plain text when there is no deep link", () => {
    wrap(<EmailSuggestionsSection enabled />);
    expect(screen.queryByRole("link", { name: /proposal follow-up/i })).not.toBeInTheDocument();
  });

  it("confirms the tapped suggestion by id", () => {
    wrap(<EmailSuggestionsSection enabled />);
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    expect(confirmMutate).toHaveBeenCalledWith("e1");
    expect(dismissMutate).not.toHaveBeenCalled();
  });

  it("dismisses the tapped suggestion by id", () => {
    wrap(<EmailSuggestionsSection enabled />);
    fireEvent.click(screen.getByRole("button", { name: /^dismiss$/i }));
    expect(dismissMutate).toHaveBeenCalledWith("e1");
    expect(confirmMutate).not.toHaveBeenCalled();
  });

  it("renders nothing when enabled but there are no suggestions", () => {
    suggestions = [];
    const { container } = wrap(<EmailSuggestionsSection enabled />);
    expect(container).toBeEmptyDOMElement();
  });
});
