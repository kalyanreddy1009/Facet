/** Shared recharts styling so the two charts can't drift apart. Literal hex
 *  values because recharts writes them into SVG attributes, where a CSS
 *  variable wouldn't resolve. Keep in step with globals.css — these are the
 *  3.0 palette, and a chart still wearing 2.0's greys next to a 3.0 panel is
 *  the most visible kind of drift there is. */
export const CHART = {
  accent: "#2a51c6", // --accent-text: a chart line IS ink, so it takes the ink value
  ok: "#2da44e",
  warn: "#d29922",
  neutral: "#6b7688",
  grid: "rgba(19,24,36,0.1)", // --border
  tick: { fontSize: 11, fill: "rgba(19,24,36,0.5)" },
  tooltip: {
    // Opaque, unlike every panel around it: a tooltip is a floating label over
    // data, and a translucent one is unreadable exactly where the data is
    // densest — which is the only place anyone opens it.
    background: "#ffffff", // --surface-1
    border: "1px solid rgba(19,24,36,0.16)", // --border-strong
    borderRadius: 9, // --radius
    fontSize: 13,
    color: "#131824", // --text
  },
  label: "#4d5872", // --text-dim
} as const;
