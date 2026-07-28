import type { ComponentType, ReactNode } from "react";

interface EmptyStateProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
  action?: ReactNode;
}

/** Empty is a state, not an accident — it says what happened and what to do. */
export default function EmptyState({ icon: Icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="panel px-6 py-12 flex flex-col items-center text-center gap-2">
      <Icon className="w-4 h-4 text-text-faint mb-1" aria-hidden />
      <p className="text-base font-semibold text-text">{title}</p>
      <p className="text-sm text-text-dim max-w-sm text-pretty">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
