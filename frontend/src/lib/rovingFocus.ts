"use client";

import type { KeyboardEvent } from "react";

/** A `radiogroup` and a `tablist` both owe the keyboard the same thing: the
 *  group is one tab stop, and arrows move between the options inside it.
 *  Clicking through five buttons with Tab is what a checkbox list does, and
 *  these aren't checkboxes.
 *
 *  Attach to the container. Works off the rendered DOM rather than an index
 *  prop, so a group whose options come and go (facet counts) can't desync.
 *
 *  Home/End jump to the ends. Selection follows focus — for a radiogroup
 *  that's what WAI-ARIA asks for, and every one of these filters is cheap and
 *  reversible. */
export function onRovingKeyDown(e: KeyboardEvent<HTMLElement>) {
  const KEYS = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"];
  if (!KEYS.includes(e.key)) return;

  const container = e.currentTarget;
  const items = Array.from(
    container.querySelectorAll<HTMLElement>('[role="radio"],[role="tab"]')
  ).filter((el) => !el.hasAttribute("disabled"));
  if (items.length === 0) return;

  const current = items.indexOf(document.activeElement as HTMLElement);
  if (current === -1) return;

  const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? items.length - 1
        : (current + step + items.length) % items.length;

  e.preventDefault();
  items[next].focus();
  items[next].click();
}
