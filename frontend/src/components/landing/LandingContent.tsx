"use client";

/**
 * The product page at the domain root — the first thing anyone sees, signed in
 * or not.
 *
 * It has three jobs at once: explain what Facet is to someone who has never
 * heard of it, fold in what used to be a separate About page, and get a
 * returning user into the app in one click without making them read any of it.
 * The last one is why the primary button resolves against the session instead
 * of being a fixed link: "Sign in" for a stranger, "Open Facet" for someone
 * who is already in.
 *
 * The page is a stack of floating glass panes over the ambient field, which is
 * the only reason that field exists — the surfaces above it are translucent
 * *to* something. Sections alternate between a full-width rhythm and a bento
 * grid, so it never becomes six identical bands of centred text.
 *
 * Nothing here blocks on the session. The page renders its full content
 * immediately and the button's label settles when /api/auth/me returns — a
 * landing page that shows a spinner while it decides what to call a button is
 * worse than one whose button briefly says the more common thing.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { Archive, ArrowRight, Check, Gem, Lock, Mountain, Scissors } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { heroProgress } from "@/lib/heroProgress";
import { useSession } from "@/lib/useSession";
import AmbientShader from "./AmbientShader";
import ProductShowcase from "./ProductShowcase";
import StoneGraphic from "./StoneGraphic";

const FAQ = [
  {
    q: "Does Facet ever invent skills, employers, or accomplishments?",
    a: "No. Your Stone, built from the resume you import, is the only source of truth about you. The AI can reorder, re-emphasize and rephrase what's genuinely there; it can't add anything that isn't. That constraint is the product, not a setting.",
  },
  {
    q: "What do I actually get for a posting?",
    a: "A tailored resume, a cover letter and a short recruiter pitch, each downloadable as PDF or Word. The layout is fixed and identical every time; only the emphasis moves, so you can send one without reading it end to end and still know what it says.",
  },
  {
    q: "How does it get LinkedIn and Naukri postings without scraping them?",
    a: "Two legitimate routes. Aggregator APIs like Adzuna and Arbeitnow already index postings syndicated from those boards and hand them over through their own API. And Facet builds the saved-search URL for each platform so you create the alert there yourself, then reads the RSS it gives you. Nothing ever logs into a job platform on your behalf: that's how accounts get banned, and the cost would land on you.",
  },
  {
    q: "Does it keep track of what happens after I apply?",
    a: "That's the Cabinet. Every facet you cut, everything you've sent, what's gone quiet and needs a nudge, and the interviews on the other side of it. Point it at your calendar feed and it will spot interview invitations and match them to the application they belong to, so the record keeps itself.",
  },
  {
    q: "Will Facet submit applications for me?",
    a: "No. The Apply-Assist extension fills the fields it recognizes on a posting you opened yourself, then stops. You review it and click Submit; that decision stays yours.",
  },
  {
    q: "Who can see my data?",
    a: "Only you. Every account on this Facet has its own database, its own workspace and its own exports; nothing is shared between them, including with whoever administers the server. The only outbound calls are to public job APIs and the AI model that does the tailoring.",
  },
  {
    q: "What does it cost?",
    a: "Nothing. This is a self-hosted install, and there is no Facet company on the other end of it to bill you.",
  },
];

/** What the app is called internally, spelled out once. The vocabulary is
 *  load-bearing everywhere else in the UI, so the landing page is the one
 *  place it gets defined rather than assumed. */
const VOCABULARY: [string, string, LucideIcon][] = [
  [
    "Stone",
    "Your real background, extracted once from your resume and edited only by you. The single source of truth: the AI never invents past it.",
    Gem,
  ],
  [
    "Rough",
    "The pool of postings gathered for you, from public job APIs and the feeds you subscribed to yourself.",
    Mountain,
  ],
  [
    "Facet",
    "One application cut for one posting: a tailored resume, a cover letter and a recruiter pitch.",
    Scissors,
  ],
  [
    "Cabinet",
    "Everywhere you have applied and what happened next, with status, replies and interviews.",
    Archive,
  ],
];

/** Reveal on scroll via IntersectionObserver — no animation library and no
 *  scroll listener.
 *
 *  It starts at opacity 0, which means that without JavaScript the entire page
 *  below the hero is invisible rather than merely unanimated. The `.reveal`
 *  class exists for the `scripting: none` rule in globals.css that undoes
 *  that — a landing page has to survive a blocked bundle, and this one
 *  silently did not. */
function Reveal({
  children,
  className = "",
  id,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  /** Anchor target, for the in-page "How it works" jump. */
  id?: string;
  /** Milliseconds. Staggers siblings so a grid arrives as a sequence rather
   *  than as one block appearing. */
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: "-8% 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      id={id}
      style={{ transitionDelay: shown ? `${delay}ms` : undefined }}
      className={`reveal ${className} transition-[opacity,transform] duration-slower ease-emph ${
        shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
      }`}
    >
      {children}
    </div>
  );
}

/** A section the stone's light reaches.
 *
 *  The beam that leaves the gem in the hero does not stop at the illustration:
 *  one bar per section sweeps across it on the same 9s clock, delayed by how
 *  far down the page the section sits, so the light visibly travels. That is
 *  the difference between an animated illustration with a page under it and a
 *  page that is lit by the illustration.
 *
 *  `overflow-hidden` matters — without it the sweep escapes its section and
 *  paints a diagonal band across the whole document. */
function LitSection({
  children,
  className = "",
  id,
  /** Position in the page, which becomes the beam's delay. */
  index,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
  index: number;
}) {
  return (
    <section id={id} className={`relative overflow-hidden ${className}`}>
      <div
        className="beam-sweep hidden motion-safe:block"
        style={{ animationDelay: `${0.35 + index * 0.55}s` }}
        aria-hidden
      />
      <div className="relative">{children}</div>
    </section>
  );
}

/** Section heading. Every section on the page gets the same three parts in the
 *  same order, which is most of what keeps a long page from drifting. */
function SectionHead({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <>
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 text-3xl sm:text-4xl font-semibold text-text text-balance tracking-[-0.02em]">
        {title}
      </h2>
      {body && <p className="mt-3 text-md text-text-dim max-w-prose text-pretty">{body}</p>}
    </>
  );
}

/** A term/definition pair, flippable. Front carries the term and its index,
 *  back carries the meaning — a click or hover rotates between them. A real
 *  `<button>` with `aria-pressed`, so a keyboard or screen-reader user gets
 *  the same control a mouse user gets, and the back is always in the DOM
 *  (just rotated away) rather than conditionally rendered, so nothing here
 *  depends on JS having run. */
function FlipCard({
  term,
  meaning,
  index,
  Icon,
}: {
  term: string;
  meaning: string;
  index: number;
  Icon: LucideIcon;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      className="flip-card w-full"
      aria-pressed={pressed}
      onClick={() => setPressed((v) => !v)}
    >
      <span className="flip-card-inner">
        <span className="flip-card-face flip-card-front liquid-glass">
          <span className="flip-card-glyph" aria-hidden>
            <Icon className="w-7 h-7" strokeWidth={1.4} />
          </span>
          <span className="mt-4 text-lg font-semibold uppercase tracking-[0.14em] text-text">
            {term}
          </span>
          <span className="mt-2 mono tnum text-xs text-accent-text" aria-hidden>
            0{index + 1}
          </span>
        </span>
        <span className="flip-card-face flip-card-back liquid-glass">
          <span className="text-sm text-text-dim text-pretty leading-relaxed text-center">
            {meaning}
          </span>
        </span>
      </span>
    </button>
  );
}

/** Phase one → phase two: the gem and its light rays open the page; scrolling
 *  down the hero's own height brings up a masthead "FACET" behind it and
 *  settles the gem smaller and lower, handing off to the content that starts
 *  right where the hero ends. `heroRef` is the whole hero `<section>`, not
 *  just the gem's small wrapper — binding to the wrapper meant the entire
 *  transform resolved in the first hundred pixels of scroll, so a full-page
 *  scroll blew straight past it before it ever registered. Tied to scroll
 *  progress with Framer's `useScroll`, not a pinned/sticky trick: this stays
 *  a normal document scroll, so it can never fight the browser's own scroll
 *  restoration or trap a trackpad gesture. `StoneGraphic` itself is never
 *  touched; only the wrapper around it moves. */
function useHeroScene(heroRef: React.RefObject<HTMLElement | null>) {
  const reduced = useReducedMotion();

  // Progress is measured here rather than by `useScroll`, which on this
  // layout returned a value that rose and then fell again over one downward
  // scroll — see `lib/heroProgress.ts`. A passive scroll listener writing one
  // MotionValue is the whole mechanism; everything below still maps off it
  // with `useTransform`, so nothing else changes and the page still never
  // touches the scroll position itself.
  const scrollYProgress = useMotionValue(0);
  useEffect(() => {
    const node = heroRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      scrollYProgress.set(heroProgress(rect.top, rect.height, window.innerHeight));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [heroRef, scrollYProgress]);

  // The gem retreats rather than leaves: it stays lit behind the word for the
  // whole of phase two, which is the point of putting the word in front of it.
  const gemScale = useTransform(scrollYProgress, [0, 0.55], [1, 0.72]);
  const gemY = useTransform(scrollYProgress, [0, 0.55], [0, -110]);
  const gemFade = useTransform(scrollYProgress, [0.2, 0.6], [1, 0.62]);

  // The word rises from below the fold and settles. It is *in front of* the
  // gem, not a watermark behind it, so it comes up at full weight.
  const mastOpacity = useTransform(scrollYProgress, [0.12, 0.42], [0, 1]);
  const mastY = useTransform(scrollYProgress, [0.12, 0.55], [220, 0]);
  const mastScale = useTransform(scrollYProgress, [0.12, 0.55], [0.7, 1]);

  // And the copy arrives only once the word has landed, which is what makes
  // the two phases read as a sequence and not as one long fade.
  const copyOpacity = useTransform(scrollYProgress, [0.55, 0.78], [0, 1]);
  const copyY = useTransform(scrollYProgress, [0.55, 0.82], [48, 0]);

  // The scroll hint is the inverse of the word arriving, by construction: it
  // cannot still be on screen once the thing it was pointing at has happened.
  const hintOpacity = useTransform(scrollYProgress, [0.02, 0.16], [1, 0]);

  return {
    reduced,
    gemScale,
    gemY,
    gemFade,
    mastOpacity,
    mastY,
    mastScale,
    copyOpacity,
    copyY,
    hintOpacity,
  };
}

export default function LandingContent() {
  const { session } = useSession();
  // single_user counts: a local checkout has no login at all, and offering
  // "Sign in" there is a button that can only lead to a page saying so.
  const signedIn = session?.authenticated === true || session?.single_user === true;

  // Where the primary action goes. `/tailor` rather than `/rough` for a
  // returning user: the thing they came back to do is cut a facet.
  const primary = signedIn
    ? { href: "/tailor", label: "Open Facet" }
    : { href: "/login", label: "Sign in" };

  // The nav and the ambient field are siblings of this `<main>` in the root
  // layout, so a class on `.landing-dark` can never reach them — which is
  // exactly why every `.landing-dark .nav-*` rule written for this page was
  // styling nothing and the bar kept its app material. One flag on the root
  // element is the only thing that can scope all three, and it comes off on
  // unmount so a client-side navigation away does not leave the app dark.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("landing-route");
    return () => root.classList.remove("landing-route");
  }, []);

  const heroRef = useRef<HTMLElement>(null);
  const {
    reduced,
    gemScale,
    gemY,
    gemFade,
    mastOpacity,
    mastY,
    mastScale,
    copyOpacity,
    copyY,
    hintOpacity,
  } = useHeroScene(heroRef);

  return (
    <main className="landing-dark">
      <AmbientShader />
      {/* ---------------------------------------------------------- hero */}
      {/* Two screens of scroll, one pinned stage.

          Phase one is the stone alone, lit, filling the viewport. Phase two
          brings the word up from below and settles it in front of the stone,
          and only then does the copy arrive. The section is twice the
          viewport tall and its contents are `sticky`, so all of that happens
          against ordinary document scroll: no scrolljacking, no wheel
          handler, nothing that can fight the browser's own scroll
          restoration or trap a trackpad gesture. `heroRef` is the tall
          section, not the pinned stage, because it is the tall one that has
          scroll range to measure. */}
      <section ref={heroRef} className="hero-stage">
        <div className="hero-pin">
          {/* The stone, behind everything, and never unmounted: it is lit
              through the whole of phase two, which is the entire reason the
              word settles in front of it rather than replacing it. */}
          <motion.div
            className="hero-gem"
            style={reduced ? undefined : { scale: gemScale, y: gemY, opacity: gemFade }}
            aria-hidden
          >
            <StoneGraphic size="clamp(16rem, 46vw, 36rem)" />
          </motion.div>

          {/* The word and the copy share one column, in flow, one above the
              other. They were two absolutely-positioned layers in the same
              grid cell and the headline landed straight on top of the
              masthead — the two most important things on the page, fighting
              for one rectangle. Stacking them normally is what makes the word
              a masthead *for* the copy rather than a second thing behind it,
              and it also means the composition is already correct at every
              intermediate scroll position rather than only at the two ends. */}
          <div className="hero-stack">
            {/* Page two: the masthead word. Decorative — the real heading is
                the h1 below it — so it is hidden from assistive tech rather
                than read out as a second title. */}
            <motion.div
              aria-hidden
              className="hero-mast"
              style={reduced ? undefined : { opacity: mastOpacity, y: mastY, scale: mastScale }}
            >
              FACET
            </motion.div>

            <motion.div
              className="hero-copy"
              style={reduced ? undefined : { opacity: copyOpacity, y: copyY }}
            >
            {/* "Your record, your machine" was true of the single-user
                checkout this page was written for and is not true of the
                deployment anyone is reading it on: this Facet is shared, and
                the promise that actually holds is isolation between
                accounts. */}
            <p className="badge badge-accent">
              <Lock className="w-3 h-3" aria-hidden />
              Your record, yours alone
            </p>
            {/* Not `text-hero`. The masthead above it is now the display
                element on this screen, and two competing display sizes in one
                pinned viewport left no room for the paragraph or the buttons
                under them. */}
            <h1 className="mt-4 text-3xl sm:text-4xl font-semibold text-accent-text text-balance tracking-[-0.02em]">
              One stone. A facet for every job.
            </h1>
            <p className="mt-4 text-lg text-text-dim max-w-prose mx-auto text-pretty">
              {/* "searches every major job board" was the one sentence on this
                  page making a claim the product does not keep: what it
                  actually queries is a set of public job APIs plus whatever
                  feeds you have subscribed to. A page whose closing promise is
                  "without inventing a single thing" cannot open by inventing
                  something. */}
              Facet keeps one honest record of your real background, searches the public job APIs
              and your own subscribed feeds from a single bar, and cuts a tailored resume, cover
              letter and recruiter pitch for each posting, then tracks what came of it. Without
              inventing a single thing.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
              <Link href={primary.href} className="btn btn-lg btn-primary">
                {primary.label}
                <span className="btn-cap" aria-hidden>
                  <ArrowRight className="w-3 h-3" />
                </span>
              </Link>
              <a href="#how" className="btn btn-lg btn-default">
                How it works
              </a>
            </div>
            <p className="mt-4 text-sm text-text-faint">
              {signedIn
                ? "You're signed in, pick up where you left off."
                : "Accounts are created by whoever administers this Facet."}
            </p>
            </motion.div>
          </div>

          {/* The one instruction phase one needs: it is a full screen with a
              gem on it and no visible affordance otherwise. Fades out as soon
              as the word starts to rise. */}
          <motion.div
            className="hero-scroll-hint"
            style={reduced ? undefined : { opacity: hintOpacity }}
            aria-hidden
          >
            Scroll
          </motion.div>
        </div>
      </section>

      {/* ---------------------------------------------------- the product */}
      {/* This one section replaced two: a bento of four cards describing the
          flow, and a static before/after card demonstrating the constraint.
          Both were the page telling you about the product in prose. The
          showcase is the product, on the real screens, doing the same four
          things in the order you meet them — including the cut, which is now
          demonstrated rather than quoted. */}
      <ProductShowcase />

      {/* ------------------------------------------------------- vocabulary */}
      <LitSection index={0} className="max-w-shell mx-auto px-5 sm:px-8 py-20">
        <Reveal className="max-w-2xl">
          <SectionHead
            eyebrow="Vocabulary"
            title="The four words"
            body="Facet borrows its language from gemcutting and uses it consistently everywhere. These are all of it."
          />
        </Reveal>
        {/* Four flip cards rather than four ruled rows.

            These are definitions — a term, its meaning, and its place in the
            sequence — and the reference this sprint is following showcases
            exactly this kind of "what is X" content as a card you turn over
            rather than a row you scan. The term sits alone on the front so
            the four read as a set at a glance; the definition is one flip
            away, which is closer to how someone actually meets this
            vocabulary — the word first, on its own, everywhere else in the
            app. */}
        <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-4">
          {VOCABULARY.map(([term, meaning, Icon], i) => (
            <Reveal key={term} delay={i * 70}>
              <FlipCard term={term} meaning={meaning} index={i} Icon={Icon} />
            </Reveal>
          ))}
        </div>
      </LitSection>

      {/* -------------------------------------------------------------- FAQ */}
      <LitSection index={1} className="max-w-3xl mx-auto px-5 sm:px-8 py-20">
        <Reveal>
          <SectionHead eyebrow="Questions" title="The ones worth asking first" />
        </Reveal>
        <div className="mt-10 flex flex-col gap-2.5">
          {FAQ.map((item, i) => (
            <Reveal key={item.q} delay={Math.min(i * 45, 180)}>
              <details className="liquid-glass faq-item group p-5 sm:p-6">
                <summary className="text-base font-medium text-text cursor-pointer list-none flex items-center justify-between gap-4">
                  {item.q}
                  <span
                    className="grid place-items-center w-6 h-6 shrink-0 rounded-full bg-accent-soft text-accent-text text-lg leading-none transition-transform duration-slow ease-emph group-open:rotate-45"
                    aria-hidden
                  >
                    +
                  </span>
                </summary>
                {/* 15px, not 13. The app can sit at 13px, that is the convention
                    for dense UI, but this is marketing copy a stranger reads once,
                    and the rule that body text clears 15px applies to them. Wrapped
                    in `.faq-body` so the open/close animates a grid track instead
                    of snapping, `<details>` has no transitionable auto-height. */}
                <div className="faq-body">
                  <div>
                    <p className="text-md text-text-dim mt-4 text-pretty leading-relaxed">{item.a}</p>
                  </div>
                </div>
              </details>
            </Reveal>
          ))}
        </div>
      </LitSection>

      {/* --------------------------------------------------------------- CTA */}
      <LitSection index={2} className="max-w-shell mx-auto px-5 sm:px-8 pb-28 pt-4">
        <Reveal>
          <div className="liquid-glass relative overflow-hidden p-10 sm:p-16 flex flex-col items-center gap-4 text-center">
            {/* One glint behind the closing card, echoing the hero stone. The
                only decoration on the page that is not the ambient field. */}
            <div
              className="absolute -top-24 left-1/2 -translate-x-1/2 w-[36rem] h-[36rem] rounded-full blur-3xl pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle, rgba(74,118,240,0.16), rgba(23,164,187,0.08) 45%, transparent 70%)",
              }}
              aria-hidden
            />
            <div className="relative flex flex-col items-center gap-4">
              <p className="eyebrow">Ready when you are</p>
              <h2 className="text-3xl sm:text-4xl font-semibold text-text text-balance tracking-[-0.02em]">
                Cut your first facet
              </h2>
              <p className="text-md text-text-dim max-w-prose text-pretty">
                {signedIn
                  ? "Your Stone and your Cabinet are where you left them."
                  : "Sign in with the address your administrator set up for you."}
              </p>
              <Link href={primary.href} className="btn btn-lg btn-primary mt-2">
                {primary.label}
                <span className="btn-cap" aria-hidden>
                  <ArrowRight className="w-3 h-3" />
                </span>
              </Link>
              <p className="text-sm text-text-faint flex items-center gap-2 mt-1">
                <Check className="w-3.5 h-3.5 text-ok-text" aria-hidden />
                Self-hosted, no account with us, nothing billed
              </p>
            </div>
          </div>
        </Reveal>
      </LitSection>
    </main>
  );
}
