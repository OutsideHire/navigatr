/**
 * GlobalSearch — the TopBar command palette.
 *
 * A search input with a results dropdown grouped by Deals / Partners /
 * Activities. Type (debounced) to query, arrow keys to move, Enter to open the
 * highlighted result, Escape to close. Cmd/Ctrl+K focuses it from anywhere.
 * Clicking a result navigates to the deal / partner (an activity jumps to its
 * parent deal, since activities have no detail page).
 *
 * Presentational + self-contained: data comes from useGlobalSearch, navigation
 * from react-router. Used inline in the desktop TopBar and inside the mobile
 * search overlay.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/navigatr";
import {
  useGlobalSearch,
  type SearchResult,
  type GlobalSearchResults,
} from "./useGlobalSearch";

const DEBOUNCE_MS = 180;

const GROUP_ORDER: { key: keyof GlobalSearchResults; label: string }[] = [
  { key: "deals", label: "Deals" },
  { key: "partners", label: "Partners" },
  { key: "activities", label: "Activities" },
];

/** Flatten the grouped results into the keyboard-navigation order. */
export function flattenResults(results: GlobalSearchResults): SearchResult[] {
  return [...results.deals, ...results.partners, ...results.activities];
}

export interface GlobalSearchProps {
  /** Focus the input on mount (used by the mobile overlay). */
  autoFocus?: boolean;
  /** Called after a result is selected (e.g. to close the mobile overlay). */
  onNavigate?: () => void;
  className?: string;
}

export function GlobalSearch({ autoFocus, onNavigate, className }: GlobalSearchProps) {
  const navigate = useNavigate();
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Debounce the term that actually drives the query.
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const { results, isLoading, isEnabled } = useGlobalSearch(debounced);
  const flat = React.useMemo(() => flattenResults(results), [results]);

  // Keep the highlighted row in range as results change.
  React.useEffect(() => {
    setActiveIndex(0);
  }, [debounced]);

  // Cmd/Ctrl+K focuses the search from anywhere.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const go = React.useCallback(
    (r: SearchResult) => {
      navigate(r.to);
      setOpen(false);
      setQuery("");
      setDebounced("");
      onNavigate?.();
    },
    [navigate, onNavigate],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (flat.length ? (i + 1) % flat.length : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
      return;
    }
    if (e.key === "Enter") {
      const target = flat[activeIndex] ?? flat[0];
      if (target) {
        e.preventDefault();
        go(target);
      }
    }
  };

  const showPanel = open && (isEnabled || query.length > 0);
  const hasResults = flat.length > 0;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <Input
        ref={inputRef}
        size="md"
        leadingIcon={Search}
        placeholder="Search deals, partners, activities…"
        aria-label="Search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="global-search-results"
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {showPanel && (
        <div
          id="global-search-results"
          role="listbox"
          className={cn(
            "absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[70vh] overflow-y-auto",
            "rounded-radius-md border border-border-subtle bg-surface-default p-1 shadow-card-hover",
          )}
        >
          {!isEnabled && (
            <p className="px-3 py-2 text-caption text-text-subtle">
              Keep typing to search deals, partners, and activities.
            </p>
          )}
          {isEnabled && isLoading && (
            <p className="px-3 py-2 text-caption text-text-subtle">Searching…</p>
          )}
          {isEnabled && !isLoading && !hasResults && (
            <p className="px-3 py-2 text-caption text-text-subtle">
              No matches for “{query.trim()}”.
            </p>
          )}
          {isEnabled &&
            !isLoading &&
            hasResults &&
            GROUP_ORDER.map(({ key, label }) => {
              const group = results[key];
              if (group.length === 0) return null;
              return (
                <div key={key} className="py-1">
                  <p className="px-3 pb-1 text-eyebrow uppercase tracking-wide text-text-subtle">
                    {label}
                  </p>
                  {group.map((r) => {
                    const idx = flat.indexOf(r);
                    const active = idx === activeIndex;
                    return (
                      <button
                        key={`${r.kind}-${r.id}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => go(r)}
                        className={cn(
                          "flex w-full flex-col items-start gap-0.5 rounded-radius-sm px-3 py-2 text-left",
                          active ? "bg-surface-sunken" : "hover:bg-surface-sunken",
                        )}
                      >
                        <span className="text-body-sm font-medium text-text-default">{r.label}</span>
                        {r.sublabel && (
                          <span className="text-caption text-text-muted">{r.sublabel}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

export default GlobalSearch;
