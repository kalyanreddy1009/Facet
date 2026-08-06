"use client";

/**
 * The hero's right half: the word FACET, split across two lines, with the
 * stone standing in the gap between them.
 *
 * The device is occlusion. The upper line paints *above* the stone and the
 * lower line *beneath* it, so the object is genuinely bracketed by the type
 * rather than sitting on top of a background that happens to be letters. That
 * single stacking difference is the whole effect; without it this is just big
 * text behind a graphic, which is what most pages do and what nobody notices.
 *
 * Two decisions worth stating, because both look like mistakes until you see
 * the alternative:
 *
 *   1. THE TYPE IS GHOSTED, NOT BLACK. At this size, ink-strength letters win
 *      every fight with the headline three inches to their left, and the hero
 *      ends up with two things shouting. Held at `--text-ghost` the word reads
 *      as a watermark the stone is standing in — present, unmistakable, and
 *      never competing with the sentence that has to be read first.
 *
 *   2. THE WORD IS BROKEN MID-SYLLABLE. "FA" over "CET" is not a wrap; it is
 *      the crop, and it only works because the two halves are right-aligned to
 *      the same edge and set at a leading under 1, so the eye takes them as
 *      one word interrupted rather than two fragments. It is also why the
 *      accessible name is on the group and the halves are hidden: a screen
 *      reader must hear "Facet", never "F A" then "C E T".
 *
 * On scroll the lines part — upper up, lower down — while the stone rises
 * through the opening gap, so the bracket *opens* as the object arrives. Only
 * `transform` animates, so all of it composites and none of it costs layout.
 * Under reduced motion the parting is dropped and the bracket sits at rest;
 * the composition is the point and it survives being still.
 */

import { useEffect, useRef, useState } from "react";
import StoneGraphic from "./StoneGraphic";

/** How far each line travels at full progress, as a fraction of the hero. The
 *  reference calls for about a fifth of the viewport each; more than that and
 *  the upper line has left the screen before the gap has finished opening. */
const PART = 96;
const RISE = 74;

export default function StoneBracket() {
  const frame = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    // Bailing here is the whole reduced-motion story: nothing ever moves the
    // progress off zero, so every transform below stays at its rest value and
    // the bracket simply sits there. No second code path to keep in step.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const read = () => {
      raf = 0;
      const node = frame.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      // Progress is how far the bracket has travelled up out of the viewport.
      // Bound to the element's own position rather than to window.scrollY, so
      // it behaves the same whether the hero is at the top of the document or
      // has something above it.
      const travel = rect.height || 1;
      setShift(Math.min(Math.max(-rect.top / travel, 0), 1));
    };

    const onScroll = () => {
      // At most one measurement per frame. Measuring inside the scroll event
      // itself is what turns a smooth page into a stuttering one.
      if (!raf) raf = requestAnimationFrame(read);
    };

    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div
      ref={frame}
      className="relative grid place-items-center isolate select-none"
      role="img"
      aria-label="Facet"
    >
      {/* The gap the stone stands in. Both halves are absolutely placed
          against this box so they part around a fixed centre rather than
          pushing each other. */}
      <div className="bracket-word" style={{ transform: `translate3d(0,${-PART * shift}px,0)` }}>
        <span aria-hidden>FA</span>
      </div>

      {/* The stone, between the two halves in the stacking order. It rises as
          the gap opens, which is what makes the parting read as the object
          arriving rather than as the type sliding. */}
      <div
        className="relative z-10 grid place-items-center"
        style={{
          transform: `translate3d(0,${-RISE * shift}px,0) scale(${1 + shift * 0.06})`,
        }}
      >
        <StoneGraphic size="clamp(13rem, 40vw, 30rem)" />
      </div>

      <div
        className="bracket-word bracket-word-lower"
        style={{ transform: `translate3d(0,${PART * shift}px,0)` }}
      >
        <span aria-hidden>CET</span>
      </div>
    </div>
  );
}
