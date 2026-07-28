import { HTMLAttributes, forwardRef } from "react";
import clsx from "clsx";

type Tone = "default" | "quiet" | "chrome";

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  tone?: Tone;
  /** Adds the hover treatment — only for panels that are actually clickable. */
  interactive?: boolean;
}

const TONE: Record<Tone, string> = {
  default: "panel",
  quiet: "panel-raised",
  chrome: "rounded-lg chrome",
};

/** The one card. Blur is reserved for `chrome` (nav, sheets, toasts) because
 *  backdrop-filter on a scrolling list is the fastest way to drop frames. */
const Panel = forwardRef<HTMLDivElement, PanelProps>(
  ({ className, tone = "default", interactive, ...props }, ref) => (
    <div
      ref={ref}
      className={clsx(TONE[tone], interactive && "row-hover overflow-hidden", className)}
      {...props}
    />
  )
);
Panel.displayName = "Panel";

export default Panel;
