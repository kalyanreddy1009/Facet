# Autonomous improvement prompt — Facet 2.0

Paste the block below as a single prompt (works standalone or with `/loop`).

---

You have standing authority to improve Facet 2.0 autonomously. Run it from
the repo root — Next.js 16 app router + Tailwind 4 + framer-motion + recharts
frontend (`frontend/src`), FastAPI backend (`backend/`), SQLite at
`data/tracker.db`, local `agy` CLI for AI calls.
Read `README.md` and `workspace/RULES.md` before your first change.

**Goal:** the best local job-search app a single person can run — the frontend
should feel like a product someone chose, not a dashboard someone generated.
Pages today: `/welcome`, `/tailor`, `/rough`, `/cabinet`, `/stone`, `/status`.

**Loop, one pass per iteration:**

1. **Pick.** Choose the single highest-leverage improvement *you* judge
   worth doing. Do not ask which. Prefer, in order: broken > confusing >
   slow > missing > pretty. Weight the job-search core (`/rough` job
   discovery, `/tailor` output quality, `/cabinet` pipeline tracking) above
   peripheral polish.
2. **Ground it.** Run the app (`python run.py`), use the real screen you're
   about to change, and read every file the change touches. Trace the flow
   end to end before editing. No fix from inference alone.
3. **Ship the smallest change that actually works.** Reuse what's in
   `components/ui/` and `lib/` before writing anything new. Native HTML and
   CSS before JS; existing deps before new ones. No new dependency unless
   the alternative is >100 lines. No abstraction with one caller.
4. **Verify.** Non-trivial logic leaves one runnable check behind
   (`frontend/src/lib/*.check.ts` pattern, or a small backend test). Confirm
   in the browser, not in your head. `npm run build` must pass clean.
5. **Record.** Append one line to `CHANGELOG.md`: what changed, why, what
   you deliberately left out. Then pick the next thing.

**Frontend standards — hold these without being asked:**

- One visual system. Reuse existing tokens/spacing/type scale; if you
  introduce a new one, migrate the old away in the same pass — no drift.
- Every async surface has all four states: loading, empty, error, success.
  Empty states say what to do next, not "no data".
- Keyboard-usable and screen-reader-labelled. Real focus rings. Contrast
  passes AA. Motion respects `prefers-reduced-motion`.
- Responsive down to 380px. Dense views scroll in their own container; the
  page body never scrolls sideways.
- Perceived speed beats real speed: optimistic updates on the tracker,
  skeletons that match final layout, no full-page spinners on navigation.
- Nothing on screen that a user of *this* app wouldn't act on.

**Never simplify away:** input validation at the API boundary, error
handling around `agy` and export (both fail in normal use), accessibility,
anything the user explicitly asked for. Local-only stays local-only — no
telemetry, no external calls beyond configured job feeds.

**Never do without asking:** delete user data (`workspace/`, `data/`),
`git push`, change the truthfulness-mode semantics, or add a paid/cloud
dependency.

**Stop condition:** none. When you can't find a real improvement, spend the
pass reducing code instead — delete something and prove nothing broke.

---

Skipped: task-tracker file, per-iteration reporting format. Add when a single
pass stops fitting in one session.
