"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, Globe, Search, SlidersHorizontal, X } from "lucide-react";
import Button from "@/components/ui/Button";
import type { Filters } from "@/lib/useJobs";

interface SearchBarProps {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  onLiveSearch: () => void;
  onOpenFilters: () => void;
  activeFilters: number;
  searching: boolean;
}

const SORTS: Array<{ value: Filters["sort"]; label: string }> = [
  { value: "match", label: "Best match" },
  { value: "recent", label: "Most recent" },
  { value: "salary", label: "Highest salary" },
  { value: "company", label: "Company A–Z" },
  { value: "title", label: "Title A–Z" },
];

export default function SearchBar({
  filters,
  onChange,
  onLiveSearch,
  onOpenFilters,
  activeFilters,
  searching,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses search the way every search-first app does — but never while
  // the person is already typing into some other field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onLiveSearch();
      }}
      className="flex flex-col lg:flex-row gap-2"
      role="search"
    >
      <div className="relative flex-1 min-w-0">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint pointer-events-none"
          aria-hidden
        />
        <input
          ref={inputRef}
          name="q"
          value={filters.q}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder="Search role, company, skill…"
          aria-label="Search jobs"
          className="field field-lg pl-9 pr-9"
          autoComplete="off"
        />
        {filters.q && (
          <button
            type="button"
            onClick={() => onChange({ q: "" })}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-faint hover:text-text focus-visible:text-text transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="relative lg:w-52">
        <Globe
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint pointer-events-none"
          aria-hidden
        />
        <input
          name="location"
          value={filters.location}
          onChange={(e) => onChange({ location: e.target.value })}
          placeholder="Location"
          aria-label="Location"
          className="field field-lg pl-9"
          autoComplete="off"
        />
      </div>

      <div className="flex gap-2">
        <label className="sr-only" htmlFor="job-sort">
          Sort results
        </label>
        <select
          id="job-sort"
          value={filters.sort}
          onChange={(e) => onChange({ sort: e.target.value as Filters["sort"] })}
          className="field field-lg w-auto cursor-pointer"
        >
          {SORTS.map((sort) => (
            <option key={sort.value} value={sort.value} className="bg-surface-2">
              {sort.label}
            </option>
          ))}
        </select>

        <Button
          type="button"
          onClick={onOpenFilters}
          className="btn-lg lg:hidden"
          icon={SlidersHorizontal}
        >
          Filters{activeFilters > 0 ? ` · ${activeFilters}` : ""}
        </Button>

        <Button
          type="submit"
          variant="primary"
          loading={searching}
          cap={ArrowRight}
          className="btn-lg"
        >
          {searching ? "Searching boards…" : "Search all boards"}
        </Button>
      </div>
    </form>
  );
}
