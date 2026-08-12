/**
 * BusinessSearchField — the search-first entry point for Add-Deal-via-Places
 * (slice D). Type a business name; pick a Google result; the parent prefills the
 * form and stashes the place metadata.
 *
 * Billing discipline lives here: 3-character floor + 300ms debounce before any
 * autocomplete call, and the resolver's session token collapses the whole
 * type->pick flow into one billed session. Below the floor / on error the
 * dropdown is simply empty — never a crash.
 */
import * as React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/navigatr";
import type { PlaceResolver } from "../hooks/usePlaceResolver";
import type { PlaceSuggestion, ResolvedPlace } from "../hooks/placeResolverTypes";

/** Matches MIN_AUTOCOMPLETE_CHARS in the resolver edge fn. Kept local so the app
 *  bundle doesn't import the Deno _shared module. */
const MIN_CHARS = 3;
const DEBOUNCE_MS = 300;

export interface BusinessSearchFieldProps {
  resolver: PlaceResolver;
  /** Called with the resolved business after the rep picks a suggestion. */
  onResolve: (place: ResolvedPlace) => void;
  /** Optional location bias (rep's current position) to rank nearby first. */
  bias?: { lat: number; lng: number };
  disabled?: boolean;
}

const dropdownBox =
  "absolute z-10 mt-1 w-full rounded-radius-md border border-border-subtle bg-surface-default shadow-card-hover";

export function BusinessSearchField({ resolver, onResolve, bias, disabled }: BusinessSearchFieldProps) {
  const [query, setQuery] = React.useState("");
  const [suggestions, setSuggestions] = React.useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = React.useState(false);
  const [searching, setSearching] = React.useState(false);
  const [resolving, setResolving] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against an out-of-order autocomplete response overwriting a newer one.
  const seqRef = React.useRef(0);

  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const runSearch = React.useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length < MIN_CHARS) {
        setSuggestions([]);
        setOpen(false);
        setSearching(false);
        return;
      }
      const seq = ++seqRef.current;
      setSearching(true);
      setOpen(true);
      void resolver.autocomplete(trimmed, bias).then((results) => {
        if (seq !== seqRef.current) return; // a newer query superseded this one
        setSuggestions(results);
        setSearching(false);
      });
    },
    [resolver, bias],
  );

  const onChange = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(text), DEBOUNCE_MS);
  };

  const onPick = async (s: PlaceSuggestion) => {
    setOpen(false);
    setResolving(true);
    const place = await resolver.resolveDetails(s.placeId);
    setResolving(false);
    if (place) {
      onResolve(place);
      resolver.newSession(); // close the billed session; next search is fresh
      setQuery("");
      setSuggestions([]);
    } else {
      // Resolution failed — reopen so the rep can try another result.
      setQuery(s.primaryText);
      setOpen(true);
    }
  };

  const showEmpty =
    open && !searching && suggestions.length === 0 && query.trim().length >= MIN_CHARS;

  return (
    <div className="relative">
      <Input
        id="business-search"
        type="text"
        inputMode="search"
        autoComplete="off"
        placeholder="Search for a business by name"
        value={query}
        disabled={disabled || resolving}
        leadingIcon={Search}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        role="combobox"
        aria-expanded={open}
        aria-controls="business-search-listbox"
      />

      {resolving && (
        <div className={`${dropdownBox} px-4 py-3 text-caption text-text-muted`}>Loading business…</div>
      )}

      {!resolving && open && searching && (
        <div className={`${dropdownBox} px-4 py-3 text-caption text-text-muted`}>Searching…</div>
      )}

      {!resolving && open && !searching && suggestions.length > 0 && (
        <ul
          id="business-search-listbox"
          role="listbox"
          className={`${dropdownBox} max-h-64 overflow-y-auto py-1`}
        >
          {suggestions.map((s) => (
            <li key={s.placeId} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:outline-none"
                onClick={() => void onPick(s)}
              >
                <span className="text-body-sm font-medium text-text-default">{s.primaryText}</span>
                {s.secondaryText && (
                  <span className="text-caption text-text-muted">{s.secondaryText}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {showEmpty && (
        <div className={`${dropdownBox} px-4 py-3 text-caption text-text-muted`}>
          No businesses found. Enter the details manually below.
        </div>
      )}
    </div>
  );
}

export default BusinessSearchField;
