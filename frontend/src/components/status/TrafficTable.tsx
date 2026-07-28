"use client";

import type { RequestMetric } from "@/lib/status";

/** p95 shaded against the slowest endpoint, so the outlier is obvious at a
 *  glance without a chart library. */
export default function TrafficTable({ rows }: { rows: RequestMetric[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-xs text-text-faint text-center">
        No requests recorded since the backend started.
      </p>
    );
  }

  const slowest = Math.max(...rows.map((r) => r.p95_ms), 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-text-faint">
            <th scope="col" className="text-left font-medium px-4 py-2">
              Endpoint
            </th>
            <th scope="col" className="text-right font-medium px-3 py-2">
              Calls
            </th>
            <th scope="col" className="text-right font-medium px-3 py-2">
              Errors
            </th>
            <th scope="col" className="text-right font-medium px-3 py-2">
              p50
            </th>
            <th scope="col" className="text-right font-medium px-3 py-2">
              p95
            </th>
            <th scope="col" className="text-right font-medium px-4 py-2">
              Max
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path} className="border-t border-border">
              <td className="px-4 py-2 mono text-text-dim max-w-0 truncate" title={row.path}>
                {row.path}
              </td>
              <td className="px-3 py-2 text-right tnum text-text-dim">
                {row.count.toLocaleString()}
              </td>
              <td
                className={`px-3 py-2 text-right tnum ${
                  row.errors > 0 ? "text-danger" : "text-text-ghost"
                }`}
              >
                {row.errors.toLocaleString()}
              </td>
              <td className="px-3 py-2 text-right tnum text-text-dim">{Math.round(row.p50_ms)}</td>
              <td className="px-3 py-2 text-right tnum text-text-dim relative">
                <span
                  className="absolute inset-y-1 right-3 bg-surface-3 rounded-sm -z-0"
                  style={{ width: `${Math.max(2, (row.p95_ms / slowest) * 44)}px` }}
                  aria-hidden
                />
                <span className="relative">{Math.round(row.p95_ms)}</span>
              </td>
              <td className="px-4 py-2 text-right tnum text-text-faint">
                {Math.round(row.max_ms)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 text-2xs text-text-ghost">Latencies in milliseconds.</p>
    </div>
  );
}
