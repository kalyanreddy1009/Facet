/** Display formatting shared by every job surface. Pure functions, no deps. */

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** SQLite writes "2026-07-01 10:00:00" (no T, no zone) — parsed as UTC. */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = /\d{4}-\d{2}-\d{2} \d{2}:/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function timeAgo(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "";
  const seconds = (date.getTime() - Date.now()) / 1000;
  const magnitude = Math.abs(seconds);
  if (magnitude < 60) return "just now";
  for (const [unit, size] of UNITS) {
    if (magnitude >= size) return RELATIVE.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function formatDate(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", INR: "₹", GBP: "£", EUR: "€" };

const trim = (n: number) => n.toFixed(1).replace(/\.0$/, "");

/** Lakh/crore only for INR — a $120,000 salary is "120k", never "1.2L". */
function compact(amount: number, indian: boolean): string {
  if (indian) {
    if (amount >= 10_000_000) return `${trim(amount / 10_000_000)}Cr`;
    if (amount >= 100_000) return `${trim(amount / 100_000)}L`;
  } else if (amount >= 1_000_000) {
    return `${trim(amount / 1_000_000)}M`;
  }
  if (amount >= 1_000) return `${Math.round(amount / 1000)}k`;
  return String(amount);
}

/** "₹12L – ₹18L", "$120k+", or "" when the posting gave us nothing. */
export function formatSalary(
  min: number | null,
  max: number | null,
  currency: string | null
): string {
  if (!min && !max) return "";
  const code = (currency || "").toUpperCase();
  const symbol = CURRENCY_SYMBOL[code] ?? "";
  const render = (n: number) => `${symbol}${compact(n, code === "INR")}`;
  if (min && max && min !== max) return `${render(min)} – ${render(max)}`;
  return `${render((min || max)!)}${min && !max ? "+" : ""}`;
}

export function matchTone(score: number | null): "strong" | "fair" | "weak" | "none" {
  if (score === null || score === undefined) return "none";
  if (score >= 60) return "strong";
  if (score >= 30) return "fair";
  return "weak";
}

/** A running clock for an operation with no progress to report: "0:07",
 *  "5:00". Not `timeAgo` — that rounds to the nearest minute, which reads as
 *  frozen for the first sixty seconds of a five-minute wait. */
export function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function pluralize(count: number, word: string, plural = `${word}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? word : plural}`;
}

/** Self-check — run with: npx tsx src/lib/format.ts */
export function demo(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
  };
  assert(formatSalary(null, null, "USD") === "", "empty salary");
  assert(formatSalary(120000, null, "USD") === "$120k+", formatSalary(120000, null, "USD"));
  assert(formatSalary(1200000, 1800000, "INR") === "₹12L – ₹18L", formatSalary(1200000, 1800000, "INR"));
  assert(formatSalary(50000, 50000, "USD") === "$50k", "equal min/max collapses");
  assert(formatSalary(20000000, null, "INR") === "₹2Cr+", formatSalary(20000000, null, "INR"));
  // Lakh/crore must never leak into a non-INR currency.
  assert(formatSalary(1200000, null, "USD") === "$1.2M+", formatSalary(1200000, null, "USD"));
  assert(formatSalary(200000, null, "USD") === "$200k+", formatSalary(200000, null, "USD"));
  assert(formatSalary(90000, null, null) === "90k+", formatSalary(90000, null, null));
  assert(parseDate("2026-07-01 10:00:00")?.toISOString() === "2026-07-01T10:00:00.000Z", "sqlite date");
  assert(parseDate("nonsense") === null, "bad date is null, not Invalid Date");
  assert(parseDate(null) === null, "null date");
  assert(matchTone(null) === "none" && matchTone(75) === "strong" && matchTone(0) === "weak", "tones");
  assert(pluralize(1, "job") === "1 job" && pluralize(2, "job") === "2 jobs", "plurals");
  assert(formatElapsed(0) === "0:00", formatElapsed(0));
  assert(formatElapsed(7) === "0:07", formatElapsed(7));
  assert(formatElapsed(60) === "1:00", formatElapsed(60));
  assert(formatElapsed(300) === "5:00", formatElapsed(300));
  assert(formatElapsed(3661) === "61:01", formatElapsed(3661));
  // Never a negative clock or a fractional second on screen.
  assert(formatElapsed(-5) === "0:00", formatElapsed(-5));
  assert(formatElapsed(9.9) === "0:09", formatElapsed(9.9));
  assert(timeAgo(new Date(Date.now() - 3600_000).toISOString()) === "1 hour ago", "relative time");
  console.log("format: all checks passed");
}
