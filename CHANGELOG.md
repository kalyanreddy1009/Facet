# Changelog

Newest first. One entry per autonomous pass (see `AUTONOMY.md`).

## 2026-07-28 — Phase 2: control plane and admin portal

`backend/control/` — a second entrypoint, not a second project. Run it with
`backend/.venv/python.exe -m control.app` → http://127.0.0.1:9000.

**Adding a user provisions a working instance.** Five idempotent, recorded
steps: directory tree → seed `RULES.md` → initialise `tracker.db` → verify
ports → write the instance `.env`. Recorded-and-idempotent is what makes a
failure survivable — a break at step 4 leaves the first three done, and
retrying resumes rather than restarting.

`tracker.db` is created by running the app's own `scripts/init_db.py` in a
subprocess with `FACET_DATA_DIR` set, not by a copy of the schema here. The
schema cannot drift from what the app expects because it *is* what the app
uses.

**Ports derive from the user id, and ids are never recycled.** That closes
the nastiest failure this design allows: a deleted user's port being reused
while a stale container or cached tunnel rule still points at it, silently
handing one person's Facet to someone else.

**Deleting is soft, and the irreversible part is 30 days away.** The flow:
typed-email confirmation (naming the account is a rarer mistake than clicking
the wrong row) → an export bundle is written automatically → the data is
*moved* to `deleted/`, not removed → recoverable in one click until the grace
period expires. `purge_expired()` is the only function that destroys
anything, and it writes to the audit log before the files go.

`VACUUM INTO` for every database copy, never `cp` — WAL keeps recent writes
in a sidecar and a plain copy silently loses them.

**Admin portal is one self-contained HTML page.** No build step, no second
`node_modules`, no second deploy. Tokens copied from `globals.css` so it
looks like Facet. Users, storage, queue and audit, refreshing every 5s.

**Found while testing:** deleting a user whose instance is still running
moves the data out from under a live process, which does not stop it —
SQLite and the logger simply recreate their files, and the "deleted" account
reappears holding a fresh empty database. Until Phase 3 can stop containers,
deletion now probes the instance's port and refuses, and the button is
disabled with the reason rather than misleading. The self-check binds a real
socket to prove the guard fires.

Also fixed a bug the lifecycle test caught: `purge_expired` used a truthiness
check on `purge_after`, so a timestamp of `0` — a legitimate "due now" —
would have been skipped forever.

Verified end-to-end: created a user, booted the app against nothing but the
provisioned directories, and it served and began ingesting its own postings
(449) fully isolated from the existing instance (1,361). Then delete →
auto-export → data moved aside → restore, with the audit log carrying the
whole story.

Not done, and deliberately left for you: migrating your own installation.
`POST /api/users/import` copies (never moves) an existing `data/` and
`workspace/` into a new instance. The original keeps working untouched —
that is the entire safety argument — so running it is your call, not mine.

## 2026-07-28 — Phase 1: agy runs on a queue

The cutting pipeline no longer blocks an HTTP request. `POST /api/tailor`
validates, enqueues, and returns **202 + `job_id`**; a worker drains the
queue one job at a time and the browser polls `/api/queue/{id}`.

Three reasons, in order of what each costs to ignore:

1. **agy is one CLI.** A second caller used to get `AgyBusyError` → 409:
   "someone is using it, try again", with no sense of when. Reasonable for
   one person, hostile for several. Now they queue and see their position.
2. **A 300-second request cannot survive a proxy.** Cloudflare's free tier
   returns 524 if headers don't arrive within 100s; nginx defaults to 60. Any
   deployment behind a domain forces the work off the request — this isn't
   polish, it's the only shape that works.
3. **Work outlives the tab.** A queued cut finishes whether or not the
   browser stays open.

**The overwrite race is gone, structurally.** `tailor.py` used to write
`workspace/job_description.md` *before* taking the agy lock, so a second
request could replace it while the first run was mid-read — producing a
resume tailored against the wrong job description, silently, with no error.
Reachable today with two tabs. Inputs are now staged per job in a directory
containing nothing else, which also tightens `--add-dir` from "the whole
workspace" to "this run's files".

**New:** `services/filelock.py` (portable advisory lock — `fcntl` on POSIX,
`msvcrt` on Windows) so agy is serialized across *processes*, not just
coroutines; `services/jobs.py` (queue, atomic claiming, failure bucketing,
crash reconciliation); `routers/queue.py`. The queue lives in its own
`data/queue.db` — operational state that can be truncated, kept away from
the record that can't.

**Removed:** `_extraction_state`, the module-global dict that gave every
caller one shared extraction status and swallowed errors no handler could
see. Extraction is a job now, so it has persistence and a real error field.

Verified end-to-end against a throwaway data directory (real profile as
input, real agy, real PDF rendering — your Cabinet untouched): a cut
completed in 55.7s through the queue; three simultaneous submissions were all
accepted with positions 1 and 2 rather than a 409; cancelling a queued job
worked and cancelling a running one correctly refused with 409 instead of
lying; job scratch directories were cleaned after every run; and a hard
`taskkill` mid-cut left the job recoverable — on restart it was marked failed
with "Interrupted — Facet restarted while this was running" rather than
stranding the browser on a spinner forever.

Known edge, not fixed: a hard kill can leave the agy grandchild running long
enough to recreate its scratch directory after the startup sweep. The result
is one empty directory that the next boot removes. Terminating the subprocess
properly needs the same machinery as cancel-a-running-job, so both are
Phase 4.

## 2026-07-28 — Phase 0: host-ready hygiene

Groundwork for the multi-user host deployment in `PLAN.md`. **No behaviour
changes** — every default reproduces the previous behaviour exactly. This
phase exists so the later ones can move data around without touching logic.

**Paths are no longer hardcoded to the repo.** Ten modules each computed
their own locations from `Path(__file__).parent.parent.parent`, which baked
in "data lives inside the repo" — right for one laptop, wrong for a host
serving several people from separate directories. New
`backend/services/paths.py` is the single source, overridable with
`FACET_DATA_DIR`, `FACET_WORKSPACE_DIR`, `FACET_TEMPLATES_DIR`. Unset, the
resolved paths are identical to before. Carries a `demo()` covering the
defaults, the derived paths, and the "empty means unset" rule — so a blank
line in an env file can't silently relocate someone's data.

**The `/api` proxy is now unconditional.** It previously applied only when
`BACKEND_ORIGIN` was set, so local runs used a second, cross-origin code path
that production never exercised. Local now defaults to
`http://localhost:8000` through the same rewrite, and `api.ts` defaults to
same-origin — no host or port in the bundle, CORS never consulted anywhere.

**`run.py` serves production by default**, with `--dev` for dev servers and
`--build` to force a rebuild. `next dev` costs roughly 3× the memory of `next
start` and recompiles per request, and `uvicorn --reload` will abandon an
in-flight agy run when it restarts — neither belongs in front of anyone but
you.

**Startup moved to `lifespan`**, replacing the deprecated `@app.on_event`
pair. The scheduler now stops before the rest of shutdown, so a poll can't
start against a closing database.

**Removed:** `enhance.txt` and `improvement.txt` (byte-identical copies of an
executed brief), `frontend/README.md` (untouched `create-next-app`
boilerplate), `backend/scripts/seed_demo_data.py` (writes demo rows into
`tracker.db` — harmless on a laptop, a loaded footgun on a shared host), a
stray root `__pycache__`, and two empty directories from a shell-quoting
slip. `.claude-flow/` is now gitignored rather than deleted — it holds a live
daemon's state.

Verified against the real database: all 8 self-checks pass, `tsc` and `npm
run build` clean, lint unchanged at 0 errors, and a production run serves
1,354 postings through the proxy with no console errors.

## 2026-07-28 — Dependency upgrade: Next 16, React 19, Tailwind 4

Everything moved to the latest version that **actually works together**. Five
major jumps. Two deliberate holds, both because "latest" is currently broken
with the rest of the stack — documented in place so nobody "fixes" them back.

| | From | To |
|---|---|---|
| next | 14.2.35 | **16.2.12** |
| react / react-dom | 18.3.1 | **19.2.8** |
| tailwindcss | 3.4.19 | **4.3.3** |
| typescript | 5.9.3 | **6.0.3** (not 7 — see below) |
| eslint | 8.57.1 | **9.39.5** (not 10 — see below) |
| eslint-config-next | 14.2.35 | **16.2.12** |
| @types/node · react · react-dom | 20 · 18 · 18 | **26 · 19 · 19** |
| lucide-react · recharts · postcss | | latest patch |
| fastapi · pydyf (backend) | 0.139.2 · 0.11.0 | **0.140.7 · 0.12.1** |

**Two versions deliberately held back, with reasons:**

- **ESLint 9, not 10.** `eslint-config-next@16` bundles an
  `eslint-plugin-react` that still calls `context.getFilename()`, removed in
  ESLint 10. Its peer range advertises `>=9.0.0`, but 10 throws
  `TypeError: contextOrFilename.getFilename is not a function` on every file.
- **TypeScript 6, not 7.** TS 7 is the native port and does not expose the
  compiler API Next needs: *"TypeScript 7.0.2 does not provide the compiler API
  required by Next.js … or install TypeScript 6 instead."* It also breaks
  `eslint-config-next` at require time. Next offers an `experimental`
  escape hatch; an experimental flag is not "stable", so TS 6 it is.

**What broke and had to be fixed, none of it caught by a compiler:**

- **Every `<button>` silently lost its pointer cursor.** Tailwind 4's preflight
  sets `button { cursor: default }` per spec; v3 shipped `pointer`. Anchors kept
  the hand, buttons didn't — the exact kind of regression that builds clean and
  just feels wrong. One rule in `globals.css` restores it for buttons and for
  `[role=button|tab|radio]`, rather than `cursor-pointer` on ~40 call sites.
- **`useModal`'s ref type.** React 19 types `useRef<T>(null)` as
  `RefObject<T | null>`; the signature now says so.
- **`next lint` no longer exists** (removed in 16) and ESLint 9 dropped
  eslintrc. `.eslintrc.json` → `eslint.config.mjs` (flat), `lint` script →
  `eslint .`.
- **Stale `.next` from Next 14** made the first 16 build fail with
  `PageNotFoundError` on pages that plainly exist. Clean rebuild fixes it —
  worth knowing before debugging a phantom.
- **New lint rule, 6 hits, downgraded to warn.** `react-hooks/set-state-in-effect`
  is newly enabled by eslint-config-next 16. All six hits are legitimate
  external-system syncs — fetch on mount, prefill from sessionStorage, read a
  `matchMedia` result. None causes cascading renders in practice. Refactoring
  every data-fetch path in the app to satisfy a new style rule *during* a
  five-major upgrade is how upgrades break things; left visible as warnings and
  worth its own deliberate pass with the React Compiler.

**Tailwind 4 kept the design system intact.** `@import "tailwindcss"` plus
`@config "../../tailwind.config.ts"` — the v4 native form is a CSS `@theme`
block, but every token already lives in `:root` and the JS config only maps
utility names onto those variables, so porting it would be a large diff whose
entire upside is syntax. Verified after the move: `--accent` `#3a68d6`,
`--accent-text` `#4c7ef3`, `--text-faint` `#8590a1`, `--border-control` at
alpha 0.38, `--ease-out` `cubic-bezier(.2,.8,.2,1)`, hero 72.5px at
line-height 0.95, `.btn-cap` 24px/100px white-on-accent — all still exactly as
set. `/welcome` renders pixel-identical to the pre-upgrade screenshot.

Node floors updated to match: `frontend/Dockerfile` `node:20-alpine` →
`node:24-alpine`, and `run.py` now warns below **22.6** rather than 18 — Next 16
needs 20.9+, but `npm run check` runs a `.ts` file directly and needs Node's
type stripping at 22.6+. The repo previously claimed 18.17+ while shipping a
test suite that couldn't run on it.

Verified end-to-end on the real stack, not just compiled: all 7 backend checks,
`npm run check`, `tsc --noEmit`, `lint` (0 errors), `build` — clean; and
`/welcome`, `/rough` (1,284 postings), `/cabinet` (recharts under React 19),
`/tailor` (OptionCards state, roving tabindex, `--border-control` on fields)
loaded in a browser against the live backend with **zero console errors**.

Not upgraded: Python stays 3.10.20 — the venv interpreter is a documented
constraint and a Python bump is its own task. Worth scheduling before 3.10 goes
end-of-life in October 2026.

## 2026-07-28 — Part A visual patterns; WCAG measured and fixed; a real race

Closes everything `enhance.txt` (identical to `improvement.txt`) left deferred
after the 07-26 pass. Nothing here changes business logic, an API contract, the
data model, the gemcutting vocabulary, or the meaning of any user-facing copy.
`tracker.db` was not touched: no migration, no schema change, no rewrite.

**The bug that mattered — a genuine late-response race in `useJobs`.** `loadMore`
had no AbortController and no staleness check. Change a filter while a page-2
request is in flight and the old response lands afterwards, appending rows from
the *previous* query onto the new query's first page and overwriting the new
`total` with the old one. Page 1 was already abort-protected; page 2 was not.
Now `loadMore` has its own controller (it runs *alongside* the page-1 fetch, so
it can't share one), the filter effect aborts it, and a superseded response is
dropped whole. Reproducer: type into the filter while scrolled far enough down
that the sentinel has fired.

Also in `useJobs`: the reported `total` now subtracts optimistically-dismissed
rows. "1,166 postings" over 1,165 cards is a small lie that lasted until the
next fetch. `hasMore` still compares the raw numbers — paging is about what the
server has, not what's shown.

**`tags` / `match_terms` could 500 the whole job list.** The same
`json.loads(x) if x else []` expression appeared in four places in
`routers/feeds.py`; it guards empty but not malformed. One truncated or
hand-edited JSON column and `/api/jobs` dies entirely, taking every other
posting with it. Replaced with one `decode_list()` that returns `[]` for NULL,
empty, unparseable, or right-JSON-wrong-shape. 9 asserts, runnable with
`backend/.venv/python.exe -m routers.feeds`.

**WCAG AA, measured for the first time — and the token layer failed in three
places.** All three confirmed with the user before anything changed, because
they alter the whole app. Full before/after table in `docs/ui-audit.md` §5.

- White on the primary button was **3.76:1** — the most important text in the
  app, below AA. The finding underneath it: *a single indigo cannot pass in both
  roles.* Dark enough for white label text means too dark to *be* text on a dark
  surface. So `--accent` is now `#3a68d6` for **fills** (5.08:1 with white) and
  `--accent-text` keeps `#4c7ef3` for **ink** (4.59–5.17:1). Darkening globally
  without the split would have fixed the button and broken the four
  accent-as-text sites — trading one failure for another.
- `--text-faint` `#6e7a8c` → `#8590a1`. It carries every hint, count and
  `.label` in the app and failed on every surface (3.57–4.47:1); now 4.82–6.02:1.
- `.field` and `.btn-default` boundaries were **1.5:1**. New `--border-control`
  at alpha 0.38 (3.02–3.22:1) — scoped to actual controls. Panel and divider
  borders stay whisper-thin at 0.09/0.16 on purpose: they're the depth cue, not
  a control boundary, and 1.4.11 doesn't reach them. Reasons for every
  deliberate remaining failure are in the audit, including two that are
  arithmetic-only (`--surface-4` holds the scrollbar thumb and nothing else).

**Part A's four patterns**, within cool graphite, everything in the REJECT list
still rejected: `/welcome` hero on the `hero` scale at `line-height: 0.95`
(Inter, no new font, that page only); `.btn-cap` trailing affordance —
*inverted* from the source spec, since our primary button already **is** the
accent and an accent circle on it would be invisible; `OptionCards`, selection
as a 1px accent border on the same surface step, no fill change; and one
documented easing set, with the five framer-motion sites that must duplicate
the numbers now importing them from `lib/motion.ts` instead of writing
`[0.16, 1, 0.3, 1]` five times.

**Keyboard.** `lib/useModal.ts` now holds the modal contract — Escape, focus in,
**Tab trap**, scroll lock, focus restore — and `/rough`'s mobile filter overlay,
which had none of the five, uses the same hook as `Sheet`. `lib/rovingFocus.ts`
gives `Segmented`, all five `FilterRail` groups and `OptionCards` the arrow-key
navigation a native radio group has for free.

**Honest progress during a cut.** `LoadingOverlay` ran out of phrases after 12
seconds and then sat still for up to five minutes, which reads as a frozen page.
It now shows a ticking elapsed clock against agy's real 300s ceiling. No
progress bar: we genuinely don't know the progress, so we don't draw one.
`formatElapsed` in `lib/format.ts`, 7 new asserts.

**`/welcome`** stopped swallowing its stats fetch failure into an empty
`.catch()` — "0 facets cut" and "we couldn't ask" are different claims. Loading
is a height-reserved skeleton so the panel can't shift. **`/cabinet`** gained a
terminal error state with a retry instead of an empty page behind a toast that
auto-dismisses.

Measured, production build via `next start`, live 1,166-row DB (`docs/perf.md`):
`/welcome` LCP **338 ms** (budget 1.5 s), `/rough` LCP **447–717 ms** across two
runs (budget 1.2 s), CLS **0.00** both, INP while typing **40 ms** (budget
200 ms), zero console errors or warnings. `python run.py` → `/welcome`
answering: **39 s** cold. Nothing was optimized in response — everything passed
with margin, and an optimization without a number attached doesn't land. The
`/rough` spread between two identical runs is real; treat the budget as met
with room, not as a 447 ms guarantee.

Found and deliberately left alone: the "On-site / hybrid" filter emits
`remote = 0`, which excludes rows where `remote` is NULL (unknown), so a posting
that never stated its arrangement is invisible under that filter — a business-
logic decision, out of scope here. `framer-motion` still earns its place (the
reduced-motion path runs through `useReducedMotion` in six files; 147 kB First
Load on the heaviest route isn't a measured problem). No new index: the query
plan still shows the GROUP BY dominating. `--text-ghost` placeholder contrast
(1.8–2.5:1) left as-is — every field has a real label carrying the same
information and the placeholders are examples, not instructions. The two
"Senior Python Engineer, EPAM" rows are still two rows, and still correctly so:
different python.org postings under `/8117/` and `/8107/`, exactly the case the
07-26 dedup rule was written not to merge.

Verified: all six backend checks, the new `routers.feeds` check, `npm run check`,
`npx tsc --noEmit`, `npm run lint`, `npm run build` — all clean; `/welcome`,
`/rough` and `/tailor` confirmed in a real browser against the live DB.

## 2026-07-26 — Collapse re-listed postings; reduced-motion holes; audits

**Dedup (`improvement.txt` Part B).** The brief's diagnosis — "one job arriving
from two sources" — did not match the data. All 10 duplicate groups were
same-source, different-URL: boards re-list an unchanged job under a new slug
(`…-senior-software-engineer-1`). More importantly, the proposed fix (fall back
to title+company) would have *merged genuinely different jobs*: two Concape
openings in Kempten and Ravensburg share a title and employer, and two
Himalayas postings from `tilt-com` and `flex-one` both parse as "Unknown
company". Hiding a real opening from a job seeker is worse than showing a row
twice, so the rule shipped is conservative and was confirmed with the user
before writing code.

- `services/job_sources.py` — `canonical_posting_url()` strips query, fragment,
  trailing slash and a **hyphen-prefixed** repost suffix; `dedup_key()` groups
  only when canonical URL *and* title *and* company all agree. The hyphen rule
  is load-bearing: stripping trailing digits by path segment instead would turn
  `python.org/jobs/8117/` and `/8107/` into one key and collapse every job on
  that board into a single row. 11 new asserts, including every must-not-merge
  pair, as fixtures copied out of the live DB rather than read from it.
- `services/db.py` — registers `dedup_key` as a SQLite function, so SQL and
  ingest share one definition of identity instead of two that drift.
- `routers/feeds.py` — `/api/jobs` and `/api/jobs/facets` both collapse on read
  via `id IN (SELECT MIN(id) … GROUP BY dedup_key(…))`. Facets had to change
  too or every filter count would promise more rows than the list can show.
  **No migration, no rehash, `tracker.db` untouched and the rule reversible.**

Result on live data: 906 rows → 900, 6 collapsed across 5 groups, all 4
ambiguous groups correctly preserved. Cost: ~3.5 ms of SQL, invisible in a
15.7 ms request. Ceiling and upgrade path documented in `docs/perf.md`.

**Reduced motion.** `recharts` animates in JS, so the
`prefers-reduced-motion` block in `globals.css` never reached it —
`FacetsView`'s `<Line>` and `ApplicationsView`'s `<Funnel isAnimationActive>`
kept animating. Both now honour `useReducedMotion()`. This was the only real
hole in the reduced-motion story.

**Focus states.** `AgyHealthBanner` and `SearchBar` had `hover:` colour changes
with no `focus-visible:` equivalent — a keyboard user couldn't see what a mouse
user could.

**Audits written:** `docs/ui-audit.md` (3 token findings app-wide, keyboard and
four-states gaps, plus a list of deliberate non-findings so they don't get
"fixed" later) and `docs/perf.md` (bundle, API latency, query plans).

Deferred, with reasons in the docs: the `/rough` mobile-filter focus trap
(should be added once in `Sheet` and reused), arrow-key nav on `Segmented` and
`FilterRail`, `/welcome` loading + swallowed fetch error, `/cabinet` terminal
error state, Part A's four visual patterns, WCAG contrast measurement, and
browser-side LCP/CLS/INP numbers. No `company`/`promoted` index was added —
the query plan shows the GROUP BY dominates, so it would cost sync writes and
buy nothing measurable.

## 2026-07-26 — Show the evidence behind a match score

`match_score` ranks The Rough, drives the sort, and gates the min-score
filter, but the keywords that produced it were computed and discarded. A card
said "50% match" with nothing to check it against, so the number couldn't be
trusted or calibrated — and a posting scoring high off one stray word looked
identical to a real fit.

- `services/matching.py` — new `posting_match_terms()`; `posting_match_score()`
  now derives its hit count from it, so score and evidence can't disagree.
  Side effect: a duplicated keyword no longer double-counts toward the score.
- `services/db.py` — `match_terms TEXT` via the existing `_POSTING_COLUMNS`
  migration. Existing rows backfill on the next sync, which already refreshes
  `match_score`.
- `services/feed_ingest.py` — stores the terms on insert and on conflict,
  always alongside the score.
- `routers/feeds.py` — decoded in `/api/jobs` like `tags`.
- `JobCard.tsx` — a "Matches" line, first 5 terms, `+N more` with the rest in
  the title attribute. Plain text, not chips: a second row of pills next to
  the tag line would out-shout the job title.
- `globals.css` — `contain-intrinsic-size` 118px → 140px to match the taller
  card, so the scrollbar doesn't jump as offscreen rows resolve.

Verified: `matching.py` self-check passes (4 new asserts), `npm run build`
clean, `/api/jobs` returns populated terms against the real 828-row DB, and
`/rough` renders it with no console errors.

Left out: no way to *edit* which skills count — the term list is whatever the
Stone extraction produced. Add if the matches read as consistently wrong.

Found, not fixed: the same posting appears twice ("Senior Python Engineer,
EPAM"), so `posting_hash` isn't deduping the same job arriving from two
sources. Next pass.
