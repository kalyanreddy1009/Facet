/** The motion tokens from `globals.css`, as numbers.
 *
 *  framer-motion can't read a CSS custom property inside a `transition`
 *  object, so these values have to exist twice. They exist twice *here*, in
 *  one file, instead of once per component — that's the only way the two
 *  copies stay in sync. If you change `--ease-out` or `--t`, change these.
 *
 *  Durations are seconds (framer), not ms (CSS). */

/** `--ease-out` — entrances. */
export const EASE_OUT = [0.16, 0.84, 0.24, 1] as const;

/** `--ease-emph` — emphasised movement: a sheet, a panel, a layout shift.
 *  The long tail is the point; it reads as settling rather than stopping. */
export const EASE_EMPH = [0.16, 1, 0.3, 1] as const;

/** `--ease-exit`. Not `linear` any more: at these durations a linear exit
 *  reads as a dropped frame. Accelerating away is the honest shape. */
export const EASE_EXIT = [0.4, 0, 1, 1] as const;

/** `--t-fast` / `--t` / `--t-slow`, in seconds. */
export const T_FAST = 0.12;
export const T = 0.2;
export const T_SLOW = 0.32;

/** Standard entrance: use with `reduced ? REDUCED : ENTER`. */
export const ENTER = { duration: T, ease: EASE_OUT } as const;

/** Entrance for something large, or travelling far — a sheet, a modal, a
 *  column that slides in. The same 200ms that feels crisp on a 4px nav
 *  indicator feels abrupt on a 400px panel, so distance gets the longer
 *  duration and the emphasised curve. */
export const ENTER_EMPH = { duration: T_SLOW, ease: EASE_EMPH } as const;

/** Exits run shorter than entrances. Nobody is waiting to watch something go. */
export const EXIT = { duration: T_FAST, ease: EASE_EXIT } as const;

/** For anything the pointer is directly manipulating, where a fixed duration
 *  reads as canned. Damped just short of visible overshoot. */
export const SPRING = { type: "spring", stiffness: 420, damping: 38, mass: 0.9 } as const;

/** What every `useReducedMotion()` branch collapses to. */
export const REDUCED = { duration: 0 } as const;
