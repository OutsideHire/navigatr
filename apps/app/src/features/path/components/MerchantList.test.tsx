import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MerchantList, type MerchantWithDistance } from "./MerchantList";

function row(id: string, over: Partial<MerchantWithDistance> = {}): MerchantWithDistance {
  return {
    id, name: id, category: "automotive", address: "a", lat: 35.0, lng: -97.0,
    phone: "", employeeCountRange: "1-10", status: "untouched", lastActivity: null,
    isChain: false, distanceMeters: 100, ...over,
  } as MerchantWithDistance;
}

const POOL = [row("Acme"), row("Bravo"), row("Charlie")];

describe("MerchantList", () => {
  it("renders each merchant's name", () => {
    render(<MerchantList merchants={POOL} />);
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  it("shows the empty state when there are no merchants", () => {
    render(<MerchantList merchants={[]} />);
    expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();
  });

  describe("fit flag", () => {
    it("shows the unfit label on a merchant in unfitIds", () => {
      render(
        <MerchantList
          merchants={POOL}
          unfitIds={new Set(["Bravo"])}
          unfitLabel="won't fit before 12:00 PM"
        />,
      );
      expect(screen.getByText("won't fit before 12:00 PM")).toBeInTheDocument();
    });

    it("does not show the label on a merchant not in unfitIds", () => {
      render(
        <MerchantList
          merchants={[row("Acme"), row("Bravo")]}
          unfitIds={new Set(["Bravo"])}
          unfitLabel="won't fit before 12:00 PM"
        />,
      );
      // Only one row carries the label (Bravo), not Acme.
      expect(screen.getAllByText("won't fit before 12:00 PM")).toHaveLength(1);
    });

    it("renders as before when unfitIds/unfitLabel are omitted", () => {
      render(<MerchantList merchants={POOL} />);
      expect(screen.getByText("Acme")).toBeInTheDocument();
      expect(screen.queryByText("won't fit before 12:00 PM")).not.toBeInTheDocument();
    });

    it("shows no label when unfitLabel is missing even if unfitIds matches", () => {
      render(<MerchantList merchants={POOL} unfitIds={new Set(["Acme"])} />);
      expect(screen.queryByText(/won't fit/i)).not.toBeInTheDocument();
    });
  });
});
