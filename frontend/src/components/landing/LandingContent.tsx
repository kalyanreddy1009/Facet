"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { api, type DashboardSummary } from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";
import StoneGraphic from "./StoneGraphic";

const FAQ = [
  {
    q: "Does Facet ever invent skills, employers, or accomplishments?",
    a: "No. profile.json — built from the resume you import — is the only source of truth about you. The AI can reorder, re-emphasize and rephrase what's genuinely there; it can't add anything that isn't.",
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
    q: "Where does my data live?",
    a: "On your machine, in this app's own folders. The only outbound calls are to public job APIs and your own local agy CLI. There's no Facet server.",
  },
];

const STEPS = [
  {
    title: "One honest record",
    body: "Import your resume once. It becomes your Stone — the fixed set of facts every application is built from.",
  },
  {
    title: "Every board, one search",
    body: "Postings from public job APIs and the alerts you've subscribed to, deduplicated and ranked against your Stone. Search and filter across all of them at once.",
  },
  {
    title: "A facet per job",
    body: "Cut a tailored resume, cover letter and recruiter pitch for a specific posting. Same layout every time — only the emphasis moves.",
  },
];

/** The stats panel is the one place on this page that talks to the backend.
 *  It used to swallow the failure into an empty `.catch()`, so a backend that
 *  wasn't running looked identical to a Cabinet with nothing in it — "0 facets
 *  cut" is a very different claim from "we couldn't ask". */
function useStats() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let live = true;
    api
      .dashboardSummary()
      .then((res) => {
        if (!live) return;
        setSummary(res);
        setState("ready");
      })
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, []);

  return { summary, state };
}

/** Reveal on scroll via IntersectionObserver — no animation library, no
 *  scroll listener, and it degrades to "already visible" if JS is slow. */
function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
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
      { rootMargin: "-10% 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`${className} transition-[opacity,transform] duration ease-out ${
        shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}
    >
      {children}
    </div>
  );
}

export default function LandingContent() {
  const { summary, state } = useStats();
  const responseRate =
    summary?.response_rate != null ? `${Math.round(summary.response_rate * 100)}%` : "—";

  return (
    <main>
      <section className="max-w-shell mx-auto px-5 sm:px-8 min-h-[calc(100vh-var(--nav-h))] grid lg:grid-cols-[1.25fr_0.75fr] items-center gap-12 py-16">
        <div className="flex flex-col items-start gap-5">
          <p className="label">Runs entirely on your machine</p>
          {/* The one expressive surface in the app. Leading under 1 is the
              point — it only reads at this size, and this is the only page
              that gets it. Everything else stays at 13–14px body. */}
          <h1 className="text-hero font-semibold text-text text-balance">
            One stone.
            <br />
            A facet for every job.
          </h1>
          <p className="text-md text-text-dim max-w-prose text-pretty">
            Facet keeps one honest record of your real background, searches every major job board
            from a single bar, and cuts a tailored resume, cover letter and recruiter pitch for each
            posting — without inventing a single thing.
          </p>
          <div className="flex flex-wrap gap-2 mt-1">
            <Link href="/rough" className="btn btn-lg btn-primary">
              Find jobs
              <span className="btn-cap" aria-hidden>
                <ArrowRight className="w-3 h-3" />
              </span>
            </Link>
            <Link href="/stone" className="btn btn-lg btn-default">
              Import your resume
            </Link>
          </div>
        </div>

        <div className="hidden lg:grid place-items-center">
          <StoneGraphic size={260} />
        </div>
      </section>

      <Reveal className="max-w-shell mx-auto px-5 sm:px-8 py-12">
        <div className="grid sm:grid-cols-3 gap-4">
          {STEPS.map((step) => (
            <div key={step.title} className="panel p-5 flex flex-col gap-2">
              <h2 className="text-base font-semibold text-text">{step.title}</h2>
              <p className="text-sm text-text-dim text-pretty">{step.body}</p>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal className="max-w-shell mx-auto px-5 sm:px-8 py-12">
        <div className="panel p-6 grid grid-cols-3 gap-6 text-center" aria-busy={state === "loading"}>
          {[
            { value: String(summary?.funnel.Cut ?? 0), label: "Facets cut" },
            { value: String(summary?.funnel.Set ?? 0), label: "Applications sent" },
            { value: responseRate, label: "Response rate" },
          ].map((stat) => (
            <div key={stat.label}>
              {/* Reserve the number's exact box in every state so the panel
                  can't shift when the fetch lands. A div, not a p: `Skeleton`
                  renders a div, and a div inside a p is invalid HTML — the
                  browser closes the p early and React's hydration then finds
                  a tree that doesn't match the server's. */}
              <div className="mono text-3xl text-text tnum h-[38px] flex items-center justify-center">
                {state === "loading" ? (
                  <Skeleton className="h-7 w-12" />
                ) : state === "error" ? (
                  <span className="text-text-ghost">—</span>
                ) : (
                  stat.value
                )}
              </div>
              <p className="text-sm text-text-faint mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
        <p className="text-sm text-text-faint text-center mt-3">
          {state === "error"
            ? "Couldn't reach the local backend, so these are unknown — not zero. Check Status."
            : "Real numbers from your own Cabinet — zero until you've actually used it."}
        </p>
      </Reveal>

      <Reveal className="max-w-3xl mx-auto px-5 sm:px-8 py-12">
        <h2 className="text-2xl font-semibold text-text mb-5">What it actually writes</h2>
        <div className="panel p-5 flex flex-col gap-5">
          <div>
            <p className="label mb-1.5">From your stone, unchanged</p>
            <p className="text-md text-text-dim">
              &ldquo;Worked on backend services for the payments team.&rdquo;
            </p>
          </div>
          <div className="border-t border-border pt-5">
            <p className="label mb-1.5">
              Cut for a posting that asks for event-driven architecture
            </p>
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

      <Reveal className="max-w-3xl mx-auto px-5 sm:px-8 py-12">
        <h2 className="text-2xl font-semibold text-text mb-5">Questions</h2>
        <div className="flex flex-col gap-2">
          {FAQ.map((item) => (
            <details key={item.q} className="panel p-4 group">
              <summary className="text-base font-medium text-text cursor-pointer list-none flex items-center justify-between gap-4">
                {item.q}
                <span
                  className="text-text-faint shrink-0 transition-transform duration-fast group-open:rotate-45"
                  aria-hidden
                >
                  +
                </span>
              </summary>
              <p className="text-sm text-text-dim mt-3 text-pretty">{item.a}</p>
            </details>
          ))}
        </div>
      </Reveal>

      <section className="max-w-shell mx-auto px-5 sm:px-8 py-20 flex flex-col items-center gap-4 text-center">
        <h2 className="text-2xl font-semibold text-text text-balance">
          Ready to cut your first facet?
        </h2>
        <p className="text-base text-text-dim max-w-prose text-pretty">
          Free, local, and no account — there&apos;s no server on our end to charge for.
        </p>
        <Link href="/rough" className="btn btn-lg btn-primary mt-1">
          Find jobs
          <span className="btn-cap" aria-hidden>
            <ArrowRight className="w-3 h-3" />
          </span>
        </Link>
      </section>
    </main>
  );
}
