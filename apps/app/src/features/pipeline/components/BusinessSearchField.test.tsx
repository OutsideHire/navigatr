// BusinessSearchField — the Add-Deal Places search. Focus: the location bias
// resolves async (GPS / active-path) AFTER the sheet opens, so a fast rep can
// type before it lands and get an unbiased (nationwide) first search. The field
// must re-issue that search once bias arrives.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { BusinessSearchField } from "./BusinessSearchField";
import type { PlaceResolver } from "../hooks/usePlaceResolver";

function makeResolver(): PlaceResolver {
  return {
    autocomplete: vi.fn().mockResolvedValue([]),
    resolveDetails: vi.fn().mockResolvedValue(null),
    newSession: vi.fn(),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("BusinessSearchField", () => {
  it("runs autocomplete with the bias after the debounce", async () => {
    const resolver = makeResolver();
    render(<BusinessSearchField resolver={resolver} onResolve={() => {}} bias={{ lat: 40, lng: -105 }} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "sunset" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(resolver.autocomplete).toHaveBeenCalledWith("sunset", { lat: 40, lng: -105 });
  });

  it("re-issues the search when the location bias resolves after the rep already typed", async () => {
    const resolver = makeResolver();
    const { rerender } = render(<BusinessSearchField resolver={resolver} onResolve={() => {}} bias={undefined} />);
    // Rep types before their location resolves -> first search is unbiased.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "sunset" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(resolver.autocomplete).toHaveBeenLastCalledWith("sunset", undefined);

    // Location resolves -> bias arrives -> the current query is re-searched with it.
    await act(async () => {
      rerender(<BusinessSearchField resolver={resolver} onResolve={() => {}} bias={{ lat: 40, lng: -105 }} />);
    });
    expect(resolver.autocomplete).toHaveBeenLastCalledWith("sunset", { lat: 40, lng: -105 });
  });

  it("does NOT re-issue when bias arrives but the query is below the min length", async () => {
    const resolver = makeResolver();
    const { rerender } = render(<BusinessSearchField resolver={resolver} onResolve={() => {}} bias={undefined} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "su" } }); // < MIN_CHARS (3)
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    (resolver.autocomplete as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      rerender(<BusinessSearchField resolver={resolver} onResolve={() => {}} bias={{ lat: 40, lng: -105 }} />);
    });
    expect(resolver.autocomplete).not.toHaveBeenCalled();
  });
});
