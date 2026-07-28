"use client";

import { onRovingKeyDown } from "@/lib/rovingFocus";

export interface Option<T extends string> {
  value: T;
  label: string;
  /** One line of consequence. What picking this actually does. */
  blurb?: string;
}

interface OptionCardsProps<T extends string> {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  /** Names the group for screen readers — required, not decorative. */
  label: string;
  className?: string;
}

/** Mutually-exclusive choice, card-shaped, for when each option needs a
 *  sentence of explanation that a row of segments can't carry.
 *
 *  Selection is a 1px accent border on the SAME surface step — no fill
 *  change, no shadow, no scale. That's the accent rule the whole app already
 *  follows: the accent marks current state, it doesn't decorate. A filled
 *  card would out-shout the primary button sitting under it.
 *
 *  One tab stop for the group, arrows between the cards. */
export default function OptionCards<T extends string>({
  value,
  options,
  onChange,
  label,
  className = "",
}: OptionCardsProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onRovingKeyDown}
      className={`grid gap-2 ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            // Only the selected card is in the tab order; arrows reach the rest.
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`text-left p-3 rounded border bg-surface-2 transition-colors duration-fast ${
              active
                ? "border-accent"
                : "border-border hover:border-border-strong focus-visible:border-border-strong"
            }`}
          >
            <span className={`text-sm font-medium ${active ? "text-text" : "text-text-dim"}`}>
              {option.label}
            </span>
            {option.blurb && (
              <p className="text-xs text-text-faint mt-1 text-pretty">{option.blurb}</p>
            )}
          </button>
        );
      })}
    </div>
  );
}
