// Coverage for ContactsTab (Deal Contacts tab, Task 2).
//
// Mocks all four useDealContacts hooks; `contactsData` is module-level so each
// test can set the additional-contacts list before render. Radix Dialog/Select
// polyfills in beforeAll (mirrors DealContactSheet.test.tsx).

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ContactsTab } from "./ContactsTab";
import { MOCK_DEALS } from "../mockData";

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  }
});

let contactsData: any[] = [];
vi.mock("../hooks/useDealContacts", () => ({
  useDealContacts: () => ({ data: contactsData, isLoading: false }),
  useCreateDealContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateDealContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDealContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const deal = MOCK_DEALS[0];

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ContactsTab deal={deal} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  contactsData = [];
});

describe("ContactsTab", () => {
  it("renders the primary contact with a 'Primary' label", () => {
    renderTab();
    expect(screen.getByText(deal.contactName)).toBeInTheDocument();
    expect(screen.getByText(/primary/i)).toBeInTheDocument();
  });

  it("renders an additional contact with its role pill", () => {
    contactsData = [
      {
        id: "c1", dealId: deal.id, name: "Dana Rep", title: "Buyer",
        email: "dana@co.com", phone: "+15551234567", role: "gatekeeper",
        note: null, createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    renderTab();
    expect(screen.getByText("Dana Rep")).toBeInTheDocument();
    expect(screen.getByText("Gatekeeper")).toBeInTheDocument();
  });

  it("renders an empty state when there are no additional contacts", () => {
    contactsData = [];
    renderTab();
    expect(screen.getByText(/no additional contacts yet/i)).toBeInTheDocument();
  });

  it("opens the sheet when 'Add contact' is clicked", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /add contact/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /add contact/i })).toBeInTheDocument();
  });
});
