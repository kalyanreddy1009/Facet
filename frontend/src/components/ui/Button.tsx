import { ButtonHTMLAttributes, forwardRef } from "react";
import clsx from "clsx";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "ghost" | "quiet";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  /** Trailing affordance cap. `primary` only, and only on the one action a
   *  view is actually about — see `.btn-cap` in globals.css. */
  cap?: React.ComponentType<{ className?: string }>;
}

/** `ghost` is the ordinary secondary action (bordered); `quiet` the borderless
 *  one used for icon-only and tertiary controls. */
const VARIANT: Record<Variant, string> = {
  primary: "btn-primary",
  ghost: "btn-default",
  quiet: "btn-ghost",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "ghost", loading, icon: Icon, cap: Cap, children, disabled, ...props },
    ref
  ) => (
    <button
      ref={ref}
      type="button"
      // A loading button stays mounted and sized — swapping it for a spinner
      // makes the layout jump under the cursor.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx("btn", VARIANT[variant], className)}
      {...props}
    >
      {loading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
      ) : (
        Icon && <Icon className="w-3.5 h-3.5" aria-hidden />
      )}
      {children}
      {Cap && !loading && (
        <span className="btn-cap" aria-hidden>
          <Cap className="w-3 h-3" />
        </span>
      )}
    </button>
  )
);
Button.displayName = "Button";

export default Button;
