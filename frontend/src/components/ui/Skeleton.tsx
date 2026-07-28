import clsx from "clsx";

/** Placeholder sized like the real thing, so nothing shifts when data lands. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} aria-hidden />;
}

export function JobCardSkeleton() {
  return (
    <div className="panel p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Skeleton className="h-4 w-52" />
        <Skeleton className="h-5 w-20 rounded-sm" />
      </div>
      <Skeleton className="h-3 w-full max-w-md" />
      <Skeleton className="h-3 w-40" />
    </div>
  );
}

export function JobListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <JobCardSkeleton key={i} />
      ))}
    </div>
  );
}
