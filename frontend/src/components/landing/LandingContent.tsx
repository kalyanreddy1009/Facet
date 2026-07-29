"use client";

/**
 * The product page at the domain root — the first thing anyone sees, signed in
 * or not.
 *
 * It has to do three jobs at once: explain what Facet is to someone who has
 * never heard of it, fold in what used to be a separate About page, and get a
 * returning user into the app in one click without making them read any of it.
 * The last one is why the primary button resolves against the session instead
 * of being a fixed link: "Sign in" for a stranger, "Open Facet" for someone
 * who is already in.
 *
 * Nothing here blocks on that answer. The page renders its full content
 * immediately and the button's label settles when /api/auth/me returns — a
 * landing page that shows a spinner while it decides what to call a button is
 * worse than one whose button briefly says the more common thing.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Lock, Search, Sparkles } from "lucide-react";
import { useSession } from "@/lib/useSession";
import StoneGraphic from "./StoneGraphic";

const FAQ = [
  {
    q: "Does Facet ever invent skills, employers, or accomplishments?",
    a: "No. Your Stone — built from the resume you import — is the only source of truth about you. The AI can reorder, re-emphasize and rephrase what's genuinely there; it can't add anything that isn't. That constraint is the product, not a setting.",
  },
  {
    q: "How does it get LinkedIn and Naukri postings without scraping them?",
    a: "Two legitimate routes. Aggregator APIs like Jooble already index postings syndicated from those boards and hand them over through their own API. And Facet builds the saved-search URL for each platform so you create the alert there yourself. Nothing ever logs into a job platform on your behalf — that's how accounts get banned, and the cost would land on you.",
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

const STEPS = [
  {
    icon: Sparkles,
    title: "One honest record",
    body: "Import your resume once. It becomes your Stone — the fixed set of facts every application is built from, and the ceiling on what anything Facet writes is allowed to claim.",
  },
  {
    icon: Search,
    title: "Every board, one search",
    body: "Postings from public job APIs and the alerts you've subscribed to, deduplicated and ranked against your Stone. Search and filter across all of them at once instead of tab by tab.",
  },
  {
    icon: Check,
    title: "A facet per job",
    body: "Cut a tailored resume, cover letter and recruiter pitch for a specific posting. Same layout every time — only the emphasis moves, and only within what your Stone supports.",
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

/** Reveal on scroll via IntersectionObserver — no animation library, no
 *  scroll listener, and it degrades to "already visible" if JS is slow. */
function Reveal({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  /** Anchor target, for the in-page "How it works" jump. */
  id?: string;
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
      className={`${className} transition-[opacity,transform] duration-slower ease-emph ${
        shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      }`}
    >
      {children}
    </div>
  );
}

export default function LandingContent() {
  const { session } = useSession();
  const signedIn = session?.authenticated === true;

  // Where the primary action goes. `/tailor` rather than `/rough` for a
  // returning user: the thing they came back to do is cut a facet.
  const primary = signedIn
    ? { href: "/tailor", label: "Open Facet" }
    : { href: "/login", label: "Sign in" };

  return (
    <main>
      {/* ---------------------------------------------------------- hero */}
      <section className="max-w-shell mx-auto px-5 sm:px-8 min-h-[calc(100vh-var(--nav-h))] grid lg:grid-cols-[1.15fr_0.85fr] items-center gap-12 py-20">
        <div className="flex flex-col items-start gap-6">
          <p className="badge badge-accent">
            <Lock className="w-3 h-3" aria-hidden />
            Your record, your machine
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
            Facet keeps one honest record of your real background, searches every major job board
            from a single bar, and cuts a tailored resume, cover letter and recruiter pitch for each
            posting — without inventing a single thing.
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

        <div className="hidden lg:grid place-items-center">
          <StoneGraphic size={320} />
        </div>
      </section>

      {/* ------------------------------------------------------- how it works */}
      <Reveal className="max-w-shell mx-auto px-5 sm:px-8 py-16 scroll-mt-nav" id="how">
        <h2 className="text-3xl font-semibold text-text text-balance">How it works</h2>
        <p className="mt-2 text-md text-text-dim max-w-prose text-pretty">
          Three steps, and the first one happens exactly once.
        </p>
        <ol className="mt-8 grid sm:grid-cols-3 gap-4">
          {STEPS.map((step, i) => (
            <li
              key={step.title}
              className="panel panel-lit p-6 flex flex-col gap-3"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="grid place-items-center w-8 h-8 rounded-lg bg-accent-soft border border-accent-border text-accent-text"
                  aria-hidden
                >
                  <step.icon className="w-4 h-4" />
                </span>
                <span className="mono text-xs text-text-ghost tnum">0{i + 1}</span>
              </div>
              <h3 className="text-lg font-semibold text-text">{step.title}</h3>
              <p className="text-sm text-text-dim text-pretty">{step.body}</p>
            </li>
          ))}
        </ol>
      </Reveal>

      {/* ------------------------------------------------- the honesty proof */}
      <Reveal className="max-w-3xl mx-auto px-5 sm:px-8 py-16">
        <h2 className="text-3xl font-semibold text-text text-balance">What it actually writes</h2>
        <p className="mt-2 text-md text-text-dim text-pretty">
          The difference between tailoring and fabricating, on one line of your resume.
        </p>
        <div className="mt-8 card p-6 flex flex-col gap-6">
          <div>
            <p className="label mb-2">From your stone, unchanged</p>
            <p className="text-md text-text-dim">
              &ldquo;Worked on backend services for the payments team.&rdquo;
            </p>
          </div>
          <div className="border-t border-border pt-6">
            <p className="label mb-2">Cut for a posting that asks for event-driven architecture</p>
            <p className="text-md text-text">
              &ldquo;Built backend services for the payments team, including the event-driven
              reconciliation pipeline the posting calls out.&rdquo;
            </p>
          </div>
        </div>
        <p className="text-sm text-text-faint mt-3">
          Re-emphasized and re-worded — never a claim your Stone doesn&apos;t support.
        </p>
      </Reveal>

      {/* ------------------------------------------------------- vocabulary */}
      <Reveal className="max-w-shell mx-auto px-5 sm:px-8 py-16">
        <h2 className="text-3xl font-semibold text-text text-balance">The four words</h2>
        <p className="mt-2 text-md text-text-dim max-w-prose text-pretty">
          Facet borrows its vocabulary from gemcutting, and uses it consistently everywhere. These
          are all of it.
        </p>
        <dl className="mt-8 grid sm:grid-cols-2 gap-4">
          {VOCABULARY.map(([term, meaning]) => (
            <div
              key={term}
              className="panel panel-lit p-5"
            >
              <dt className="text-base font-semibold text-text">{term}</dt>
              <dd className="mt-1.5 text-sm text-text-dim text-pretty">{meaning}</dd>
            </div>
          ))}
        </dl>
      </Reveal>

      {/* -------------------------------------------------------------- FAQ */}
      <Reveal className="max-w-3xl mx-auto px-5 sm:px-8 py-16">
        <h2 className="text-3xl font-semibold text-text mb-8 text-balance">Questions</h2>
        <div className="flex flex-col gap-2.5">
          {FAQ.map((item) => (
            <details key={item.q} className="panel p-5 group">
              <summary className="text-base font-medium text-text cursor-pointer list-none flex items-center justify-between gap-4">
                {item.q}
                <span
                  className="text-text-faint shrink-0 text-lg leading-none transition-transform duration-slow ease-emph group-open:rotate-45"
                  aria-hidden
                >
                  +
                </span>
              </summary>
              <p className="text-sm text-text-dim mt-3.5 text-pretty">{item.a}</p>
            </details>
          ))}
        </div>
      </Reveal>

      {/* --------------------------------------------------------------- CTA */}
      <section className="max-w-shell mx-auto px-5 sm:px-8 py-24">
        <div className="card p-10 sm:p-14 flex flex-col items-center gap-4 text-center">
          <h2 className="text-3xl font-semibold text-text text-balance">
            Ready to cut your first facet?
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
        </div>
      </section>
    </main>
  );
}
