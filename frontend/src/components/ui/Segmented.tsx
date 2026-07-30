"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useId } from "react";
import { ENTER, REDUCED } from "@/lib/motion";
import { onRovingKeyDown } from "@/lib/rovingFocus";

export interface Segment<T extends string> {
  value: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}

interface SegmentedProps<T extends string> {
  value: T;
  segments: Segment<T>[];
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
}

/** Tab strip with a sliding indicator. One `layoutId` per instance, so two
 *  segmented controls on the same page don't animate into each other. */
export default function Segmented<T extends string>({
  value,
  segments,
  onChange,
  label,
  size = "md",
}: SegmentedProps<T>) {
  const reduced = useReducedMotion();
  const layoutId = useId();

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onRovingKeyDown}
      className="inline-flex p-0.5 gap-0.5 rounded bg-surface-1 border border-border"
    >
      {segments.map((segment) => {
        const active = segment.value === value;
        const Icon = segment.icon;
        return (
          <button
            type="button"
            key={segment.value}
            role="tab"
            aria-selected={active}
            // One tab stop for the strip; arrows move between the tabs.
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(segment.value)}
            className={`relative rounded-sm font-medium transition-colors duration-fast flex items-center gap-1.5 ${
              size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-3 text-sm"
            } ${active ? "text-white" : "text-text-faint hover:text-text-dim"}`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-sm seg-active"
                transition={reduced ? REDUCED : ENTER}
              />
            )}
            {Icon && <Icon className="relative w-3.5 h-3.5" />}
            <span className="relative whitespace-nowrap">{segment.label}</span>
          </button>
        );
      })}
    </div>
  );
}
