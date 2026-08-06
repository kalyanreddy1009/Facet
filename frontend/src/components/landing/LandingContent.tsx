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
import {
  ArrowRight,
  CalendarCheck,
  Check,
  FileDown,
  Layers,
  Lock,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useSession } from "@/lib/useSession";
import StoneGraphic from "./StoneGraphic";

const FAQ = [
  {
    q: "Does Facet ever invent skills, employers, or accomplishments?",
    a: "No. Your Stone — built from the resume you import — is the only source of truth about you. The AI can reorder, re-emphasize and rephrase what's genuinely there; it can't add anything that isn't. That constraint is the product, not a setting.",
  },
  {
    q: "What do I actually get for a posting?",
    a: "A tailored resume, a cover letter and a short recruiter pitch, each downloadable as PDF or Word. The layout is fixed and identical every time — only the emphasis moves, so you can send one without reading it end to end and still know what it says.",
  },
  {
    q: "How does it get LinkedIn and Naukri postings without scraping them?",
    a: "Two legitimate routes. Aggregator APIs like Adzuna and Arbeitnow already index postings syndicated from those boards and hand them over through their own API. And Facet builds the saved-search URL for each platform so you create the alert there yourself, then reads the RSS it gives you. Nothing ever logs into a job platform on your behalf — that's how accounts get banned, and the cost would land on you.",
  },
  {
    q: "Does it keep track of what happens after I apply?",
    a: "That's the Cabinet. Every facet you cut, everything you've sent, what's gone quiet and needs a nudge, and the interviews on the other side of it. Point it at your calendar feed and it will spot interview invitations and match them to the application they belong to, so the record keeps itself.",
  },
  {
    q: "Will Facet submit applications for me?",
    a: "No. The Apply-Assist extension fills the fields it recognizes on a posting you opened yourself, then stops. You review it and click Submit — that decision stays yours.",
  },
  {
    q: "Who can see my data?",
    a: "Only you. Every account on this Facet has its own database, its own workspace and its own exports; nothing is shared between them, including with whoever administers the server. The only outbound calls are to public job APIs and the AI model that does the tailoring.",
  },
  {
    q: "What does it cost?",
    a: "Nothing. This is a self-hosted install — there is no Facet company on the other end of it to bill you.",
  },
];

/** The four things the app does, in the order you meet them. Two of them are
 *  marked wide: importing happens exactly once and everything depends on it,
 *  and the Cabinet is where the work ends up. The grid should say that before
 *  the copy does. */
const STEPS = [
  {
    icon: Sparkles,
    title: "One honest record",
    body: "Import your resume once. It becomes your Stone — the fixed set of facts every application is built from, and the ceiling on what anything Facet writes is allowed to claim.",
    wide: true,
  },
  {
    icon: Search,
    title: "Every board, one search",
    body: "Postings from public job APIs and the alerts you've subscribed to, deduplicated and ranked against your Stone.",
    wide: false,
  },
  {
    icon: FileDown,
    title: "A facet per job",
    body: "A tailored resume, cover letter and recruiter pitch for one posting — as PDF or Word.",
    wide: false,
  },
  {
    icon: CalendarCheck,
    title: "And what came of it",
    body: "The Cabinet holds what you've sent, what has gone quiet, and the interviews that followed. Connect a calendar feed and it files those itself.",
    wide: true,
  },
];

/** What the app is called internally, spelled out once. The vocabulary is
 *  load-bearing everywhere else in the UI, so the landing page is the one
 *  place it gets defined rather than assumed. */
const VOCABULARY = [
  ["Stone", "Your real background. Imported once, edited by you, never by the AI."],
  ["Rough", "The unsorted pool of postings Facet has found for you."],
  ["Facet", "One application, cut for one posting."],
  ["Cabinet", "Everywhere you've applied, and what happened next."],
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

  return (
    <main>
      {/* ---------------------------------------------------------- hero */}
      <section className="max-w-shell mx-auto px-5 sm:px-8 min-h-[calc(100svh-var(--nav-block))] grid lg:grid-cols-[1.02fr_0.98fr] items-center gap-10 lg:gap-14 py-16 sm:py-20">
        {/* `z-10`, and that is the whole fix for the headline. The stone's fan
            is drawn with `overflow-visible` so the light genuinely crosses the
            page — which is the best thing on this screen and worth keeping —
            but it was painting *over* the type, and "A facet for" sat under a
            violet wash that read as a rendering fault rather than as light.
            Raising the copy above the beam keeps the crossing and gives the
            words back their contrast. Decoration never wins against text. */}
        <div className="relative z-10 flex flex-col items-start gap-6">
          {/* "Your record, your machine" was true of the single-user checkout
              this page was written for and is not true of the deployment
              anyone is reading it on: this Facet is shared, and the promise
              that actually holds is isolation between accounts. The FAQ below
              says exactly this — the badge was the one place still claiming
              something the product had grown out of. */}
          <p className="badge badge-accent">
            <Lock className="w-3 h-3" aria-hidden />
            Your record, yours alone
          </p>
          {/* The one expressive surface in the app. Leading under 1 is the
              point — it only reads at this size, and this is the only page
              that gets it. Everything else stays at 13–14px body. */}
          <h1 className="text-hero font-semibold text-text text-balance">
            One stone.
            <br />
            A facet for every job.
          </h1>
          <p className="text-lg text-text-dim max-w-prose text-pretty">
            {/* "searches every major job board" was the one sentence on this
                page making a claim the product does not keep: what it actually
                queries is a set of public job APIs plus whatever feeds you have
                subscribed to — which is what the "Every board, one search" card
                below has always said. A page whose closing promise is "without
                inventing a single thing" cannot open by inventing something. */}
            Facet keeps one honest record of your real background, searches the public job boards
            and your own subscribed feeds from a single bar, and cuts a tailored resume, cover letter
            and recruiter pitch for each posting — then tracks what came of it. Without inventing a
            single thing.
          </p>
          <div className="flex flex-wrap items-center gap-2.5 mt-1">
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
          <p className="text-sm text-text-faint">
            {signedIn
              ? "You're signed in — pick up where you left off."
              : "Accounts are created by whoever administers this Facet."}
          </p>
        </div>

        {/* The stone is the page, so it now renders on every width including a
            phone in portrait — which was the last viewport still getting the
            copy and none of the thing the copy is about, and is most of the
            traffic a landing page ever sees.
            It sits *after* the text in the source, so on a single column it
            lands below the buttons: the primary action keeps its place above
            the fold and the stone rewards the first scroll instead of pushing
            the page down. `z-0` pairs with the copy's `z-10` above. */}
        <div className="relative z-0 grid place-items-center">
          <StoneGraphic size="clamp(13rem, 40vw, 30rem)" />
        </div>
      </section>

      {/* ------------------------------------------------------- how it works */}
      <LitSection index={0} id="how" className="max-w-shell mx-auto px-5 sm:px-8 py-20 scroll-mt-nav-block">
        <Reveal>
          <SectionHead
            eyebrow="How it works"
            title="Four steps, and the first happens once"
            body="Everything after the import is repetition — which is the point. Applying is the same work every time, and Facet is what makes it the same work."
          />
        </Reveal>

        {/* Bento rather than four equal tiles: the two that carry the product
            get the width, and the grid stops reading as a feature list. */}
        <ol className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {STEPS.map((step, i) => (
            <Reveal
              key={step.title}
              delay={i * 70}
              className={step.wide ? "lg:col-span-2" : "lg:col-span-1"}
            >
              <li className="glass-card glass-card-lift h-full p-7 flex flex-col gap-3.5 list-none">
                <div className="flex items-center gap-3">
                  <span
                    className="grid place-items-center w-9 h-9 rounded-xl bg-accent-soft text-accent-text ring-1 ring-accent-border"
                    aria-hidden
                  >
                    <step.icon className="w-4 h-4" />
                  </span>
                  <span className="mono text-xs text-text-ghost tnum">0{i + 1}</span>
                </div>
                <h3 className="text-lg font-semibold text-text tracking-[-0.01em]">{step.title}</h3>
                <p className="text-sm text-text-dim text-pretty leading-relaxed">{step.body}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </LitSection>

      {/* ------------------------------------------------- the honesty proof */}
      <LitSection index={1} className="max-w-shell mx-auto px-5 sm:px-8 py-20">
        <Reveal className="max-w-2xl">
          <SectionHead
            eyebrow="The constraint"
            title="What it actually writes"
            body="The difference between tailoring and fabricating, on one line of your resume."
          />
        </Reveal>

        <Reveal delay={80} className="mt-10">
          <div className="glass-card p-7 sm:p-9 grid md:grid-cols-2 gap-7">
            <div className="flex flex-col gap-2.5">
              <p className="eyebrow !text-text-faint">From your stone, unchanged</p>
              <p className="text-md text-text-dim leading-relaxed">
                &ldquo;Worked on backend services for the payments team.&rdquo;
              </p>
            </div>
            {/* The rule falls between the two on a wide screen and above the
                second on a narrow one — the comparison has to read as a pair
                either way, not as two unrelated quotes. */}
            <div className="flex flex-col gap-2.5 border-t md:border-t-0 md:border-l border-border pt-7 md:pt-0 md:pl-7">
              <p className="eyebrow">Cut for a posting asking for event-driven work</p>
              <p className="text-md text-text leading-relaxed">
                &ldquo;Built backend services for the payments team, including the event-driven
                reconciliation pipeline the posting calls out.&rdquo;
              </p>
            </div>
          </div>
          <p className="text-sm text-text-faint mt-4 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-ok-text shrink-0" aria-hidden />
            Re-emphasized and re-worded — never a claim your Stone doesn&apos;t support.
          </p>
        </Reveal>
      </LitSection>

      {/* ------------------------------------------------------- vocabulary */}
      <LitSection index={2} className="max-w-shell mx-auto px-5 sm:px-8 py-20">
        <Reveal className="max-w-2xl">
          <SectionHead
            eyebrow="Vocabulary"
            title="The four words"
            body="Facet borrows its language from gemcutting and uses it consistently everywhere. These are all of it."
          />
        </Reveal>
        <dl className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {VOCABULARY.map(([term, meaning], i) => (
            <Reveal key={term} delay={i * 70}>
              <div className="glass-card glass-card-lift h-full p-6">
                <dt className="flex items-center gap-2 text-base font-semibold text-text">
                  <Layers className="w-4 h-4 text-accent-text" aria-hidden />
                  {term}
                </dt>
                <dd className="mt-2 text-sm text-text-dim text-pretty leading-relaxed">
                  {meaning}
                </dd>
              </div>
            </Reveal>
          ))}
        </dl>
      </LitSection>

      {/* -------------------------------------------------------------- FAQ */}
      <LitSection index={3} className="max-w-3xl mx-auto px-5 sm:px-8 py-20">
        <Reveal>
          <SectionHead eyebrow="Questions" title="The ones worth asking first" />
        </Reveal>
        <div className="mt-10 flex flex-col gap-2.5">
          {FAQ.map((item, i) => (
            <Reveal key={item.q} delay={Math.min(i * 45, 180)}>
              <details className="glass-card group p-5 sm:p-6">
                <summary className="text-base font-medium text-text cursor-pointer list-none flex items-center justify-between gap-4">
                  {item.q}
                  <span
                    className="grid place-items-center w-6 h-6 shrink-0 rounded-full bg-accent-soft text-accent-text text-lg leading-none transition-transform duration-slow ease-emph group-open:rotate-45"
                    aria-hidden
                  >
                    +
                  </span>
                </summary>
                <p className="text-sm text-text-dim mt-4 text-pretty leading-relaxed">{item.a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </LitSection>

      {/* --------------------------------------------------------------- CTA */}
      <LitSection index={4} className="max-w-shell mx-auto px-5 sm:px-8 pb-28 pt-4">
        <Reveal>
          <div className="glass-card relative overflow-hidden p-10 sm:p-16 flex flex-col items-center gap-4 text-center">
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
