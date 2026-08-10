"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, Globe, Search, SlidersHorizontal, X } from "lucide-react";
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
      className="flex flex-col lg:flex-row gap-2 v2-sans"
      role="search"
    >
      <div className="relative flex-1 min-w-0">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
          style={{ color: "var(--v2-text-faint)" }}
          aria-hidden
        />
        <input
          ref={inputRef}
          name="q"
          value={filters.q}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder="Search role, company, skill…"
          aria-label="Search jobs"
          className="v2-field pl-9 pr-9"
          autoComplete="off"
        />
        {filters.q && (
          <button
            type="button"
            onClick={() => onChange({ q: "" })}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--v2-text-faint)" }}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="relative lg:w-52">
        <Globe
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
          style={{ color: "var(--v2-text-faint)" }}
          aria-hidden
        />
        <input
          name="location"
          value={filters.location}
          onChange={(e) => onChange({ location: e.target.value })}
          placeholder="Location"
          aria-label="Location"
          className="v2-field pl-9"
          autoComplete="off"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="v2-sr-only" htmlFor="job-sort-v2">
          Sort results
        </label>
        <select
          id="job-sort-v2"
          value={filters.sort}
          onChange={(e) => onChange({ sort: e.target.value as Filters["sort"] })}
          className="v2-field w-auto cursor-pointer"
        >
          {SORTS.map((sort) => (
            <option key={sort.value} value={sort.value}>
              {sort.label}
            </option>
          ))}
        </select>

        <button type="button" onClick={onOpenFilters} className="v2-btn lg:hidden">
          <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden />
          Filters{activeFilters > 0 ? ` · ${activeFilters}` : ""}
        </button>

        <button
          type="submit"
          disabled={searching}
          className="v2-btn v2-btn-primary grow sm:grow-0"
        >
          {searching ? "Searching boards…" : "Search all boards"}
          {!searching && <ArrowRight className="w-3.5 h-3.5" aria-hidden />}
        </button>
      </div>
    </form>
  );
}
