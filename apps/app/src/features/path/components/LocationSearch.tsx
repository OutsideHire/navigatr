import * as React from "react";
import { MapPin, Search } from "lucide-react";
import { Button, Input } from "@/components/navigatr";

interface LocationSearchProps {
  onSearch: (query: string) => void;
  searching: boolean;
  error: string | null;
  /** Focus the input on mount / when this becomes true (used by the blocked state). */
  autoFocus?: boolean;
}

/**
 * Submit-based city/ZIP search for the Path page. Deliberately NOT live
 * autocomplete — one geocode call per submit keeps API cost and complexity low.
 */
export function LocationSearch({ onSearch, searching, error, autoFocus = false }: LocationSearchProps) {
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
  const errorId = React.useId();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    onSearch(q);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className="w-44">
          <Input
            ref={inputRef}
            size="sm"
            leadingIcon={MapPin}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="City or ZIP"
            aria-label="Search by city or ZIP"
            aria-describedby={error ? errorId : undefined}
          />
        </div>
        <Button type="submit" variant="secondary" size="sm" leadingIcon={Search} loading={searching} disabled={searching}>
          Search
        </Button>
      </div>
      {error && <p id={errorId} className="text-caption text-status-warning">{error}</p>}
    </form>
  );
}
