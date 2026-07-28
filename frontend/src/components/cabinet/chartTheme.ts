/** Shared recharts styling so the two charts can't drift apart. Literal hex
 *  values because recharts writes them into SVG attributes, where a CSS
 *  variable wouldn't resolve. Keep in step with globals.css. */
export const CHART = {
  accent: "#4c7ef3",
  ok: "#3fb950",
  warn: "#d29922",
  neutral: "#8b96a8",
  grid: "rgba(230,237,246,0.09)",
  tick: { fontSize: 11, fill: "rgba(230,237,246,0.43)" },
  tooltip: {
    background: "#171b23",
    border: "1px solid rgba(230,237,246,0.16)",
    borderRadius: 7,
    fontSize: 13,
    color: "#e6edf6",
  },
  label: "#9aa6b8",
} as const;

/** The funnel is a single measure at four depths, so it reads as one accent
 *  stepping down in weight — not four unrelated hues. */
export const FUNNEL_COLORS: Record<string, string> = {
  Cut: "#2f4f8f",
  Set: "#3d6ad9",
  Interviewing: "#4c7ef3",
  Offer: "#6a93f7",
};
