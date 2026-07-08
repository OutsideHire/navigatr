import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PrivacyPage } from "./PrivacyPage";
import { TermsPage } from "./TermsPage";

function renderAt(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe("PrivacyPage", () => {
  it("renders the finalized Navigatr LLC privacy policy", () => {
    renderAt(<PrivacyPage />);
    expect(
      screen.getByRole("heading", { name: /privacy policy/i, level: 1 }),
    ).toBeInTheDocument();
    // Company + contact reflect Navigatr LLC, not OutsideHire.
    expect(screen.getAllByText(/Navigatr LLC/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/outsidehire/i)).toBeNull();
    const mail = screen.getAllByRole("link", {
      name: /privacy@getnavigatr\.io/i,
    })[0];
    expect(mail).toHaveAttribute("href", "mailto:privacy@getnavigatr.io");
  });

  it("discloses Google Calendar use and the Limited Use commitment", () => {
    renderAt(<PrivacyPage />);
    expect(
      screen.getByRole("link", {
        name: /Google API Services User Data Policy/i,
      }),
    ).toHaveAttribute(
      "href",
      "https://developers.google.com/terms/api-services-user-data-policy",
    );
    expect(screen.getAllByText(/Limited Use/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Google Calendar/i).length).toBeGreaterThan(0);
  });

  it("is NOT marked DRAFT (finalized, publish-ready)", () => {
    renderAt(<PrivacyPage />);
    expect(screen.queryByText(/not legally reviewed/i)).toBeNull();
    expect(screen.queryByText(/DRAFT/i)).toBeNull();
  });
});

describe("LegalPageShell draft banner", () => {
  it("TermsPage still shows the DRAFT banner (default behavior preserved)", () => {
    renderAt(<TermsPage />);
    expect(screen.getByText(/not legally reviewed/i)).toBeInTheDocument();
  });
});
