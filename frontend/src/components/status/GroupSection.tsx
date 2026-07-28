"use client";

import { STATUS_LABEL, STATUS_STYLE, worstStatus, type CheckGroup } from "@/lib/status";
import CheckRow from "./CheckRow";

export default function GroupSection({ group }: { group: CheckGroup }) {
  const worst = worstStatus(group.checks);
  const style = STATUS_STYLE[worst];
  // "Not configured" isn't a failure, so it shouldn't drag the ratio down.
  const applicable = group.checks.filter((c) => c.status !== "disabled");
  const healthy = applicable.filter((c) => c.status === "ok").length;

  return (
    <section className="panel overflow-hidden" aria-label={group.label}>
      <header className="flex items-start justify-between gap-4 px-4 py-3 divider">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text">{group.label}</h2>
          <p className="text-xs text-text-faint mt-0.5 text-pretty">{group.description}</p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="text-2xs text-text-faint tnum">
            {applicable.length > 0 ? `${healthy}/${applicable.length}` : "—"}
          </span>
          <span className={`badge ${style.badge}`}>{STATUS_LABEL[worst]}</span>
        </div>
      </header>

      <div>
        {group.checks.length === 0 ? (
          <p className="px-4 py-6 text-xs text-text-faint text-center">Nothing to report here.</p>
        ) : (
          group.checks.map((check) => <CheckRow key={check.key} check={check} />)
        )}
      </div>
    </section>
  );
}
