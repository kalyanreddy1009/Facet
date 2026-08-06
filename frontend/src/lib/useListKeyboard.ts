"use client";

/**
 * Keyboard control for a long list.
 *
 * The Rough can hold hundreds of postings and every one of them was, until
 * now, reachable only by mouse. That is the difference between a screen you
 * browse and a screen you work: triaging fifty postings with a trackpad is
 * fifty round trips between reading and pointing, and the reading is the part
 * that matters.
 *
 * The bindings are the ones this class of interface has settled on — j/k from
 * vi by way of every mail client, Escape to let go. Arrow keys work too,
 * because not everybody grew up in vi and the cost of supporting both is one
 * array. `/` for search is not here: SearchBar already owns that key, and two
 * window-level handlers for one binding is how a shortcut starts firing twice.
 *
 * Two rules keep it from fighting the rest of the page:
 *
 *   1. It never fires while you are typing. A `j` in the search box is a `j`.
 *      Anything with a text-entry target is ignored outright, which is why the
 *      check is on the event target rather than on a "focused" flag we would
 *      have to keep in sync.
 *   2. It never fires with a modifier held. Cmd-K, Ctrl-F and the browser's
 *      own shortcuts keep working; a list shortcut that swallows Cmd-R is a
 *      list shortcut that gets turned off.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface ListKeyboardActions<T> {
  /** Enter — the row's primary action. */
  onOpen?: (item: T) => void;
  /** t — cut a facet for this posting. */
  onPrimary?: (item: T) => void;
  /** x — dismiss. */
  onDismiss?: (item: T) => void;
}

export function useListKeyboard<T>(items: T[], actions: ListKeyboardActions<T>) {
  // -1 means "no row is selected", which is the honest starting state: the
  // page has focus but the reader has not chosen a row yet, and highlighting
  // the first one before they press anything is the app guessing.
  const [index, setIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  // The handler reads these, and re-subscribing on every keystroke of a
  // filter would be listener churn nobody needs. Synced in an effect rather
  // than assigned during render: a ref written mid-render is a value React
  // cannot see, and the linter is right to refuse it. One frame of staleness
  // is irrelevant here — nothing reads this except a keypress.
  const latest = useRef({ items, actions });
  useEffect(() => {
    latest.current = { items, actions };
  });

  const move = useCallback((delta: number) => {
    setIndex((current) => {
      const count = latest.current.items.length;
      if (count === 0) return -1;
      // First press selects the first row rather than the second — pressing
      // "down" on an unselected list means "start at the top".
      const next = current < 0 ? (delta > 0 ? 0 : count - 1) : current + delta;
      return Math.min(Math.max(next, 0), count - 1);
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Never steal a modifier chord — the browser and the OS own those.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const typing =
        target?.isContentEditable ||
        (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

      // `/` is deliberately absent: SearchBar already binds it, and two
      // window-level handlers for one key is how a shortcut starts firing
      // twice. One owner per binding.
      if (typing) {
        // Escape from a field returns you to the list rather than trapping
        // you in it — the only key that means anything while typing.
        if (event.key === "Escape") target?.blur();
        return;
      }

      const { items: list, actions: act } = latest.current;
      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault();
          move(1);
          return;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          move(-1);
          return;
        case "Escape":
          setIndex(-1);
          return;
      }

      // Everything below acts on the selected row, so it needs one.
      setIndex((current) => {
        if (current < 0 || current >= list.length) return current;
        const item = list[current];
        if (event.key === "Enter") {
          event.preventDefault();
          act.onOpen?.(item);
        } else if (event.key === "t") {
          event.preventDefault();
          act.onPrimary?.(item);
        } else if (event.key === "x") {
          event.preventDefault();
          act.onDismiss?.(item);
          // The dismissed row leaves and the next one takes its place, so the
          // cursor stays put and lands on the next posting — which is what
          // triaging a queue actually wants. Clamped by `move` on next press.
        }
        return current;
      });
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  // Keep the selected row on screen. `nearest` rather than `center` so a
  // row already comfortably visible does not make the page lurch.
  useEffect(() => {
    if (index < 0) return;
    const node = containerRef.current?.children[index] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [index]);

  // Clamped during render rather than reset in an effect. A filter change
  // replaces the list under the cursor, and an index pointing past the end —
  // or at whatever posting happened to land in that slot — reads as the
  // selection jumping to a random row. Deriving it costs nothing and avoids
  // both the extra render and a frame where the ring is in the wrong place.
  const safeIndex = index >= items.length ? -1 : index;

  return { index: safeIndex, containerRef, clear: useCallback(() => setIndex(-1), []) };
}
