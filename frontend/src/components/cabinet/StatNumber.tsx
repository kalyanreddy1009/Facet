interface StatNumberProps {
  label: string;
  value: string;
  hint?: string;
}

/** The one big-number treatment — mono and tabular, so a column of them
 *  aligns digit for digit. */
export default function StatNumber({ label, value, hint }: StatNumberProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <span className="mono text-2xl leading-none text-text tnum">{value}</span>
      {hint && <span className="text-xs text-text-faint mt-0.5">{hint}</span>}
    </div>
  );
}
