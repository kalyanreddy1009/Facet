"use client";

import { Check, RotateCcw } from "lucide-react";
import type { JobFacets } from "@/lib/api";
import { onRovingKeyDown } from "@/lib/rovingFocus";
import { activeFilterCount, EMPTY_FILTERS, type Filters } from "@/lib/useJobs";

interface FilterRailProps {
  filters: Filters;
  facets: JobFacets | null;
  onChange: (patch: Partial<Filters>) => void;
}

const AGE_OPTIONS = [
  { label: "Any time", value: null },
  { label: "Past 24 hours", value: 1 },
  { label: "Past 3 days", value: 3 },
  { label: "Past week", value: 7 },
  { label: "Past month", value: 30 },
];

const REMOTE_OPTIONS: Array<{ label: string; value: boolean | null }> = [
  { label: "Anywhere", value: null },
  { label: "Remote only", value: true },
  { label: "On-site / hybrid", value: false },
];

const SCORE_OPTIONS = [
  { label: "Any match", value: 0 },
  { label: "30%+", value: 30 },
  { label: "60%+", value: 60 },
  { label: "80%+", value: 80 },
];

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="label mb-1.5">{title}</legend>
      {children}
    </fieldset>
  );
}

/** One tab stop per group, arrows between the options — the behaviour a native
 *  `<input type="radio">` group would have given us for free. */
function RadioGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onRovingKeyDown}
      className="flex flex-col gap-0.5"
    >
      {children}
    </div>
  );
}

/** Radio-ish row. A native radio can't carry a count and stay on-grid, but the
 *  keyboard and screen-reader behaviour has to match one, hence the roles. */
function Choice({
  label,
  count,
  selected,
  onSelect,
}: {
  label: string;
  count?: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      className={`w-full flex items-center justify-between gap-2 px-2 h-7 rounded-sm text-sm text-left transition-colors duration-fast ${
        selected ? "bg-surface-3 text-text" : "text-text-dim hover:bg-surface-2 hover:text-text"
      }`}
    >
      {/* Truncation without a title is a name you can neither read nor
          recover — several source names are longer than a 240px rail. */}
      <span className="truncate" title={label}>
        {label}
      </span>
      {count !== undefined && <span className="text-xs text-text-faint tnum shrink-0">{count}</span>}
    </button>
  );
}

export default function FilterRail({ filters, facets, onChange }: FilterRailProps) {
  const activeCount = activeFilterCount(filters);

  const toggleSource = (source: string) =>
    onChange({
      sources: filters.sources.includes(source)
        ? filters.sources.filter((s) => s !== source)
        : [...filters.sources, source],
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between h-7">
        <p className="text-sm font-medium text-text">
          Filters
          {activeCount > 0 && <span className="text-text-faint tnum"> · {activeCount}</span>}
        </p>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => onChange({ ...EMPTY_FILTERS, q: filters.q, sort: filters.sort })}
            className="btn btn-ghost btn-sm"
          >
            <RotateCcw className="w-3 h-3" aria-hidden />
            Clear
          </button>
        )}
      </div>

      <Group title="Location">
        <input
          className="field"
          name="filter-location"
          placeholder="City, state, or country"
          value={filters.location}
          onChange={(e) => onChange({ location: e.target.value })}
          aria-label="Filter by location"
        />
        <RadioGroup label="Work arrangement">
          {REMOTE_OPTIONS.map((option) => (
            <Choice
              key={String(option.value)}
              label={option.label}
              count={option.value === true ? facets?.remote_count : undefined}
              selected={filters.remote === option.value}
              onSelect={() => onChange({ remote: option.value })}
            />
          ))}
        </RadioGroup>
      </Group>

      <Group title="Posted">
        <RadioGroup label="Date posted">
          {AGE_OPTIONS.map((option) => (
            <Choice
              key={String(option.value)}
              label={option.label}
              selected={filters.maxAgeDays === option.value}
              onSelect={() => onChange({ maxAgeDays: option.value })}
            />
          ))}
        </RadioGroup>
      </Group>

      <Group title="Match against your stone">
        <RadioGroup label="Minimum match">
          {SCORE_OPTIONS.map((option) => (
            <Choice
              key={option.value}
              label={option.label}
              selected={filters.minScore === option.value}
              onSelect={() => onChange({ minScore: option.value })}
            />
          ))}
        </RadioGroup>
      </Group>

      {facets && facets.sources.length > 0 && (
        <Group title="Source">
          <div className="flex flex-col gap-0.5 max-h-64 overflow-y-auto -mr-1 pr-1">
            {facets.sources.map((entry) => {
              const checked = filters.sources.includes(entry.source);
              return (
                <label
                  key={entry.source}
                  className={`flex items-center gap-2 px-2 h-7 rounded-sm text-sm cursor-pointer transition-colors duration-fast ${
                    checked ? "text-text" : "text-text-dim hover:bg-surface-2"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => toggleSource(entry.source)}
                  />
                  <span
                    aria-hidden
                    className={`w-3.5 h-3.5 rounded-sm border grid place-items-center shrink-0 transition-colors duration-fast ${
                      checked ? "bg-accent border-accent" : "border-border-strong"
                    }`}
                  >
                    {checked && <Check className="w-2.5 h-2.5 text-on-accent" strokeWidth={3} />}
                  </span>
                  <span className="truncate flex-1" title={entry.source}>
                    {entry.source}
                  </span>
                  <span className="text-xs text-text-faint tnum shrink-0">{entry.count}</span>
                </label>
              );
            })}
          </div>
        </Group>
      )}

      {facets && facets.employment_types.length > 0 && (
        <Group title="Employment type">
          <RadioGroup label="Employment type">
            <Choice
              label="Any"
              selected={!filters.employmentType}
              onSelect={() => onChange({ employmentType: "" })}
            />
            {facets.employment_types.map((entry) => (
              <Choice
                key={entry.value}
                label={entry.value}
                count={entry.count}
                selected={filters.employmentType === entry.value}
                onSelect={() => onChange({ employmentType: entry.value })}
              />
            ))}
          </RadioGroup>
        </Group>
      )}

      <Group title="Minimum salary">
        <input
          className="field tnum"
          name="salary-min"
          type="number"
          min={0}
          step={10000}
          inputMode="numeric"
          placeholder="Any"
          value={filters.salaryMin ?? ""}
          onChange={(e) => onChange({ salaryMin: e.target.value ? Number(e.target.value) : null })}
          aria-label="Minimum salary"
        />
        <p className="text-xs text-text-faint">
          {facets ? `${facets.with_salary} of ${facets.total} postings state a salary.` : " "}
        </p>
      </Group>
    </div>
  );
}
