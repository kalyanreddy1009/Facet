/** The motion tokens from `globals.css`, as numbers.
 *
 *  framer-motion can't read a CSS custom property inside a `transition`
 *  object, so these values have to exist twice. They exist twice *here*, in
 *  one file, instead of once per component — that's the only way the two
 *  copies stay in sync. If you change `--ease-out` or `--t`, change these.
 *
 *  Durations are seconds (framer), not ms (CSS). */

/** `--ease-out` — entrances. */
export const EASE_OUT = [0.2, 0.8, 0.2, 1] as const;

/** `--t-fast` / `--t`, in seconds. */
export const T_FAST = 0.1;
export const T = 0.16;

/** Standard entrance: use with `reduced ? REDUCED : ENTER`. */
export const ENTER = { duration: T, ease: EASE_OUT } as const;

/** `--ease-exit` is `linear`, which is framer's default — so an exit needs
 *  no `ease` at all, only the duration. */
export const EXIT = { duration: T, ease: "linear" } as const;

/** What every `useReducedMotion()` branch collapses to. */
export const REDUCED = { duration: 0 } as const;
