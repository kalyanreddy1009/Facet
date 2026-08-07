# Facet — everything, densely

Single-file brief. Read this first; it is written to be the cheapest complete
picture of the app. `CONTEXT.md` expands §3–§5, `.claude/skills/facet/SKILL.md`
expands the design system and pipeline, `PLAN.md` the multi-user host. If this
file disagrees with those, **this one is newer** — say so and fix the older.

Current as of 2026-08-07, commit `b4cf556`.

---

## 1. What it is

Local-only job-search assistant. One **Stone** (permanent honest record of the
user: `workspace/profile.json`) is **cut** into a tailored resume + cover letter
+ recruiter pitch, per job. SQLite, no cloud, no telemetry.

The gemcutting metaphor is load-bearing in code and copy:

| Term | Means | Route |
|---|---|---|
| Stone | the user's profile — the ceiling on every claim | `/stone` |
| Rough | pool of gathered postings, ranked | `/rough` |
| Facet | one tailored application | `/tailor` |
| Cabinet | the tracker | `/cabinet` |

## 2. Stack

| Piece | What |
|---|---|
| `frontend/` | Next.js 16 app router, React 19, TS 6, Tailwind 4, framer-motion, lucide. Port 3000. Node 22.6+. |
| `backend/` | FastAPI + uvicorn, Python 3.12 at `backend/.venv/bin/python`. Port 8000. |
| `data/` | `tracker.db` (SQLite WAL), `queue.db`, `settings.json`, `feeds.json`, `exports/`, `logs/`. Gitignored. `FACET_DATA_DIR`. |
| `workspace/` | `profile.json`, `master_resume.md`, `RULES.md`, agy handoff scratch. Gitignored. `FACET_WORKSPACE_DIR`. |
| `templates/` | `resumes/` — 7 HTML + 7 DOCX + `_base.html`; `cover_letter_template.html`. |
| `extension/` | Chrome MV3 "Apply Assist". Fills forms, **never submits**. |
| `backend/control/` | Second entrypoint: admin portal + user lifecycle for a multi-user host. `python -m control.app` → :9000. Reads user DBs read-only. |

**Every path comes from `services/paths.py`** via a `ContextVar` user scope —
nothing computes location from `__file__`. `paths.DB_PATH` is per-request.
Use `paths.X`, never `from services.paths import X`.

**Two optional external deps, both degrade gracefully, both reported on
`/status`:** the `agy` CLI (all AI features) and WeasyPrint's Pango/Cairo
(PDF/DOCX export).

## 3. The two flows

**Import (once).** resume PDF/DOCX → mechanical parse to markdown → *user
reviews and corrects* → `master_resume.md` → background agy pass extracts
`profile.json`.

**Cut a Facet.** paste/promote a JD → validated, queued, **202 + `job_id`**
(browser polls `/api/queue/{id}`) → local keyword pre-check (warns on weak
match, never blocks) → agy tailoring under a truthfulness mode →
`tailored_fields.json` → render into `data/exports/` → row in `applications`.
User marks **Set This Facet** once they have actually applied.

`/` is the landing page always and never redirects.

## 4. Non-negotiable product boundaries — design, not oversight

- **No scraping.** Postings arrive only from a provider's public API or a feed
  the user subscribed to. A scraper risks *the user's* account.
- **No auto-submit.** The extension's selector format has no `submit_selector`
  field and no `.click()` on a final control.
- **`profile.json` is the only source of truth about the user.** Employers,
  titles, dates are never touched. Modes: `strict` (default, only what is
  explicit) and `inferred_adjacent` (may claim a skill directly implied by a
  real accomplishment — always reported separately in `inferred_skills`, never
  folded into `matching_skills`).
- **Local-only.** No telemetry. Keys live in `data/settings.json` or env and
  go only to the provider they belong to, never echoed back.

## 5. Data model

`seen_postings` — dedup index *and* display row, deliberately one table.
`posting_hash` UNIQUE, `source_feed`, `source`, `company`, `title`,
`posting_url`, `posted_date`, `summary`, `match_score`, `match_terms`,
`location`, `remote`, `employment_type`, `salary_min/max/currency`, `tags`,
`first_seen_at`, `last_seen_at`, `promoted`, `dismissed`.
`tags` and `match_terms` are JSON-in-TEXT, decoded in the router.

`applications` — status ∈ `Saved, Cut, Set, Interviewing, Rejected, Offer`.

`application_events` — **append-only status history**: `application_id`,
`status`, `occurred_at`, `note`. Written by **SQLite trigger**
(`applications_status_created`, `applications_status_changed`), not by the
routers — status is written from ≥2 places (`PATCH /api/applications/{id}` and
`tailor.py`'s direct `UPDATE ... SET status='Cut'`) and a history depending on
every author remembering to append is a history with holes. Trigger uses
`WHEN NEW.status IS NOT OLD.status` — `!=` is NULL for a NULL operand.
Rows predating the table carry one backfilled event whose `note` says so.

Also: `contacts`, `interviews`, `suggested_interviews`.

`profile.json`: `name`, `contact{email,phone,location,linkedin}`,
`summary_base`, `skills[]`, `keywords[]`, `roles[]` (each with a stable `id`
the tailor output must key against), `projects[]`, `certifications[]`,
`education[]`.

**Migrations are additive-only** — `ALTER TABLE ADD COLUMN` via
`_POSTING_COLUMNS`, plus `CREATE TABLE/TRIGGER IF NOT EXISTS`. An existing
`tracker.db` must open unchanged. Schema runs lazily on first connection per
user, which is what lets a user be added without a restart.

## 6. Matching — read before touching ranking

`services/matching.py`, mirrored in `frontend/src/lib/match.ts`.

**Whole tokens, not substrings.** It used to join tokens and ask
`needle in haystack`. `Go` matched *Django*, `R` matched *career*, `Java`
matched *JavaScript*, `C` matched everything. A posting naming none of the
user's skills scored 60% and printed three of them as evidence.

Now: a keyword must appear as a whole token; a multi-word keyword as a
contiguous run. Equivalences are bought back **by name** in `ALIASES`
(`postgres`→`postgresql`, `k8s`→`kubernetes`, `golang`→`go`, …), so each is a
claim someone can read and disagree with.

| Constant | Value | Why |
|---|---|---|
| `MATCH_CEILING` | 8 | hits→0-100. Measured over 670 real postings. At 6 the top six postings all score 100% and the head of the list is a date-ordered tie. |
| `WEAK_MATCH_THRESHOLD` | 0.15 | in `routers/tailor.py`. Measured, unchanged by the rewrite: old cleared 8 postings, new clears 7. |

`_normalize` strips **trailing** dots (`python.` at a sentence end) but keeps
leading ones (`.net` is a name). `.` is inside the token pattern so `node.js`
survives whole.

The browser copy exists because the Cut page scores a 15,000-char paste on
every keystroke. `match.check.ts` runs both implementations over 16 fixtures
and asserts they agree to the digit — including the adversarial cases above.
**Blank keywords count in the denominator.** That is a wart, it is the
backend's wart, and it is mirrored deliberately; fix `matching.py` first and
let the browser follow.

`scripts/calibrate_matching.py` (read-only) measures the ceiling against real
postings. `scripts/rescore_postings.py` recomputes stored scores — needed
because The Rough sorts on `match_score` in SQL, so it cannot be derived on
read. Idempotent; never touches `promoted`/`dismissed`.

## 7. The `agy` trap — read before touching AI code

`agy -p` **silently produces nothing useful on stdout** when not attached to a
TTY, which is always true for a subprocess. So every call is a **file
handoff**: write inputs to the job dir, delete any stale output file, run agy
with an instruction naming exactly which file to read/write and saying not to
rely on stdout, read the result off disk (300s timeout).

Second edge: agy sometimes writes into `~/.gemini/antigravity-cli/scratch/`
instead of its launch directory. Fixed by `--add-dir <workspace>` on **every**
call. Without it the handoff silently breaks.

Inputs are staged per job (`prepare_job_dir`) — the old code wrote
`job_description.md` into the shared workspace before taking the lock, so a
second request could overwrite it mid-run and produce a resume tailored to the
wrong job, silently. A cross-process `filelock` serialises agy.

Env: `FACET_AGY_BIN`, `FACET_AGY_MODEL`, `FACET_AGY_TIMEOUT`.

## 8. API (68 routes across 9 routers, app routes under `/api`)

| Router | Routes |
|---|---|
| `feeds.py` | `GET /jobs` (filter/sort/paginate in SQL), `/jobs/facets`, `POST /jobs/search`, `/feeds*`, `/rough/{id}/promote\|dismiss\|restore`, `GET/PUT /settings` |
| `tailor.py` | `POST /tailor` → 202 + `job_id`; `run_tailor_job` is the handler |
| `queue.py` | `GET /queue`, `/queue/{id}` (poll), `DELETE /queue/{id}` (kills the agy process tree), `/retention` |
| `resume.py` | `/profile`, `/profile/keywords`, `/resume/templates`, `/resume/import`, `/resume/master`, `/resume/extraction-status` |
| `tracker.py` | applications/contacts/interviews CRUD, `/applications/{id}/events`, `/dashboard/summary`, file downloads |
| `calendar.py` | ICS config/sync + interview *suggestions* (always human-confirmed) |
| `status.py`, `auth.py`, `admin.py` | status/logs; login/invites/sessions; user admin |

`/dashboard/summary` derives the funnel from `application_events`: the furthest
stage is the max rank across history **and** current status (the `and` is what
makes backfilled rows count). Rejections land at the stage they reached;
genuinely unknowable ones report under `unknown` rather than being assigned
somewhere convenient. `rejected_from` is the breakdown.

Next rewrites `/api/*` to the backend, so nothing is cross-origin and
`BACKEND_ORIGIN` is a **build arg, not runtime**.

## 9. Frontend

Pages: `/` landing (public) · `/login` `/set-password` · `/rough` `/tailor`
`/cabinet` `/stone` · `/profile` `/admin` `/status`.

**Navigation:** inline pill nav ≥768px; **bottom tab bar** below it — four peer
destinations (Rough, Cut, Cabinet, Stone) with the app's own `FacetIcons`.
Replaced a hamburger. Status stays in the header at every width; it is a
diagnostic, not a fifth tab.

**Design system, enforced by tokens in `app/globals.css`, light-first** —
`:root` *is* the light theme, dark is a `prefers-color-scheme` variant. Four
neutral surface steps each with a translucent `--glass-*` form. **One** accent
(indigo `--accent #4a76f0` fill, `--accent-text` `#2a51c6` light / `#9fbaff`
dark — same hue, two lightnesses, because neither clears AA in both roles) for
the primary action and current state only. Green/amber/red strictly for status:
if it is not reporting state, it is not coloured. `--glint` cyan is the single
exception — ambient background, hero, travelling `.wordmark` gradient, never a
control. Depth = 1px border + translucent surface + one neutral shadow. Inter
for UI, JetBrains Mono for numbers.

**Sizing is rem, and that is the Dynamic Type mechanism.** `--control-h` 2rem,
lifting to 2.5rem under `pointer: coarse`. Text containers take `min-height`,
never `height`. `check-design-system.mjs` fails the build on a px `font-size`
or a px entry in the type scale.

Four motion durations (120/200/320/520ms), four curves.
`prefers-reduced-motion`, `prefers-reduced-transparency` and
`prefers-contrast: more` are all answered, none with layout movement.

`lib/`: `api.ts` (typed client + cache), `useJobs`, `useStatus`, `useSession`,
`useListKeyboard` (j/k/Enter/t/x on The Rough), `format`, `motion` (CSS tokens
as numbers for framer), `handoff` (Rough→Tailor), `match`, `jdTrim`.

## 10. Resume templates

Seven ATS-friendly templates. **One skeleton, seven skins:** `_base.html` owns
every ATS-critical *structural* decision (single column, contact in the body,
standard headings, no tables/images/floats, reverse-chronological) and no skin
can opt out. Skins move only in typeface, weight, rules, spacing — things a
parser never reads.

`chicago` (default, serif) · `zurich` · `cambridge` · `meridian` · `compact` ·
`ledger` · `bulletin`.

**ATS findings, measured with WeasyPrint + `pdftotext`. Do not undo:**

1. **Letter-spacing ≥10% of font-size destroys the heading** — extractor
   returns `P R O F E SS I O N A L`. It is a *ratio*, so a value fine at 11pt
   breaks at 8pt, and it is length-dependent, so `SKILLS` survives where
   `PROFESSIONAL SUMMARY` does not. Cap is **8%**, enforced statically.
2. **`font-variant: small-caps` breaks extraction** — comes out
   `P rofessional s ummary`. Banned.
3. `text-transform: uppercase` changes what is stored, so heading assertions
   must be case-insensitive.
4. `when()` normalises dates to `Mar 2021`, and passes through anything it does
   not recognise rather than mangling a date that was already fine.

Template choice resolves at **enqueue** time, not render time — a preference
changed while a job is queued must not retarget it. `resolve()` falls back to
the default on an unknown id rather than failing an accepted request.

Picker previews are **real renders**, generated by
`templates/build_template_previews.py` (WebP, lazy-loaded, 258KB total). A
SHA-256 manifest (with `_base.html` folded in) makes
`services.resume_templates` fail by name if a template changes without its
preview following.

## 11. Commands

```bash
backend/.venv/bin/python scripts/check_all.py     # all 18 suites, from backend/
cd frontend && npm run check                      # format, api, clipboard, match, jdTrim, design, interface
cd frontend && npx tsc --noEmit && npx eslint src scripts && npm run build
node extension/check.mjs
python run.py                                     # build + serve; --dev for dev servers
deploy/publish.sh                                 # build into .next.incoming, swap, restart
templates/build_resume_docx_templates.py          # rebuild the 7 Word shells
templates/build_template_previews.py              # rebuild picker previews
backend/.venv/bin/python scripts/calibrate_matching.py   # read-only
```

`npx eslint .` reports ~230 phantom errors from build-artifact directories.
Scope it: `npx eslint src scripts`.

`frontend/scripts/check-layout.mjs` is a Playwright sweep (overflow,
misalignment, page errors across 6 widths × 8 routes). Deliberately outside
`npm run check` — it needs a running server. Defaults to `:3100`.

## 12. Testing — no framework, on purpose

Each non-trivial module carries one runnable `demo()`/`assert` check;
`check_all.py` discovers `scripts/test_*.py` by filename, so a new suite counts
the day it is written. **Don't add pytest/jest/vitest unasked.**

Any suite must redirect `FACET_DATA_DIR` / `FACET_WORKSPACE_DIR` /
`FACET_QUEUE_DB` **before its first Facet import**, then assert the path it got
back is under that scratch root. The assert is the part that matters — three
suites silently ran against the *real* database after the multi-user refactor
moved the names they monkeypatched, and one of them opens by DELETEing rows.

## 13. Will bite you in the first ten minutes

1. **`backend/.venv/bin/python`, never bare `python`** — bare is 3.8-era and
   dies on `set[str]`. Module checks also need `env -u PYTHONPATH`.
2. **`data/` and `workspace/` are real user data.** Never delete or rebuild.
3. **Never `pkill -f <name>`.** `pkill -f "next-server"` killed the live
   frontend and 502'd the public site for four minutes. Kill by port PID:
   `ss -ltnp` (`lsof -ti:PORT` misses IPv6-bound listeners).
4. **Ports 3000/8000 may already be serving production.** Check first.
   Sandboxes go on 3100/8100 with `NEXT_DIST_DIR=.next.sbx` — never build into
   `.next`, that is the running server's own files.
5. **Unlayered CSS beats Tailwind utilities.** Component classes in
   `globals.css` are unlayered; utilities live in `@layer utilities`. A
   `md:hidden` on an element whose class sets `display` does nothing. Put the
   breakpoint in the CSS.
6. **`backdrop-filter` writes `-webkit-` first, standard second**, or the
   minifier keeps only the prefixed form and the blur silently does nothing in
   Firefox. It is also the most expensive property in `globals.css` — anything
   composited every scroll frame should be opaque instead.
7. `agy` may be absent or unauthenticated; everything else must still work.
8. **Ask first:** deleting user data · `git push` · changing truthfulness-mode
   semantics · adding a paid or cloud dependency.

## 14. Known open

- **Duplicate postings.** The same job from two sources gets two rows —
  `posting_hash` is not deduping it. Visible as two "Senior Python Engineer,
  EPAM" rows. Unfixed.
- **Planned, not built:** The Rough telling you which skills postings want that
  your Stone lacks · per-section regenerate in the Tailor (needs pipeline work,
  not UI) · Stone gap analysis.
- 84% of stored postings name zero of the user's keywords. Expected — feeds are
  broad — but it means the Rough's ranking is carried by a small head.
