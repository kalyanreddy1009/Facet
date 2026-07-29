/** Shared recharts styling so the two charts can't drift apart. Literal hex
 *  values because recharts writes them into SVG attributes, where a CSS
 *  variable wouldn't resolve. Keep in step with globals.css — these are the
 *  3.0 palette, and a chart still wearing 2.0's greys next to a 3.0 panel is
 *  the most visible kind of drift there is. */
export const CHART = {
  accent: "#86a9ff", // --accent-text: a chart line IS ink, so it takes the ink value
  ok: "#3fb950",
  warn: "#d29922",
  neutral: "#8b96a8",
  grid: "rgba(233,239,248,0.1)", // --border
  tick: { fontSize: 11, fill: "rgba(233,239,248,0.45)" },
  tooltip: {
    // Opaque, unlike every panel around it: a tooltip is a floating label over
    // data, and a translucent one is unreadable exactly where the data is
    // densest — which is the only place anyone opens it.
    background: "#171d28", // --surface-2
    border: "1px solid rgba(233,239,248,0.18)", // --border-strong
    borderRadius: 9, // --radius
    fontSize: 13,
    color: "#e9eff8", // --text
  },
  label: "#a3b0c4", // --text-dim
} as const;

/** The funnel is a single measure at four depths, so it reads as one accent
 *  stepping down in weight — not four unrelated hues. */
export const FUNNEL_COLORS: Record<string, string> = {
  Cut: "#33518f",
  Set: "#4a76f0",
  Interviewing: "#6b90f6",
  Offer: "#9dbaff",
};
