# Facet 2.0 — orientation brief

For an agent that needs the full picture before writing prompts or code.
Read alongside `README.md` (user-facing, exhaustive), `AUTONOMY.md` (how to
work here), `workspace/RULES.md` (AI truthfulness contract), `CHANGELOG.md`.

## 1. What it is, in one paragraph

A **local-only job-search assistant**. One "Stone" — a permanent, honest
record of the user's real background (`workspace/profile.json`) — gets "cut"
into a tailored resume, cover letter, and recruiter pitch per job. Runs
entirely on the user's machine: SQLite, no cloud, no accounts, no telemetry.
The domain metaphor is gemcutting and it is load-bearing in the code and
copy: **Stone** = profile, **Rough** = the raw pool of gathered postings,
**Facet** = one tailored application, **Cabinet** = the tracker.

## 2. Stack and layout

| Piece | What |
|---|---|
| `frontend/` | Next.js 16 (app router), React 19, TypeScript 6, Tailwind 4, framer-motion, recharts, lucide-react. Port 3000. Needs Node 22.6+. |
| `backend/` | FastAPI + uvicorn, Python **3.10** (conda-forge venv at `backend/.venv`, `python.exe` at its root — *not* `Scripts/`). Port 8000. |
| `data/` | `tracker.db` (SQLite, WAL), `settings.json` (API keys), `feeds.json`, `logs/facet.log`, `exports/`. Gitignored. Relocatable via `FACET_DATA_DIR`. |
| `workspace/` | `profile.json`, `master_resume.md`, `RULES.md`, and the agy file-handoff scratch (`job_description.md`, `tailored_fields.json`). Gitignored. Relocatable via `FACET_WORKSPACE_DIR`. |
| `templates/` | `resume_template.html`, `cover_letter_template.html`, `resume_template.docx`. |
| `extension/` | Chrome MV3 "Apply Assist" — fills forms, never submits. Selector maps for greenhouse/lever/workday/linkedin. |
| Launch | `python run.py` builds and serves production; `--dev` for dev servers, `--build` to force a rebuild, `--setup` to install only. Docker compose also supported. |

**Every path comes from `backend/services/paths.py`.** Nothing computes its
own location from `__file__` — that hardcoded "data lives inside the repo",
which is wrong for a host serving several people. Defaults reproduce the
in-repo layout exactly, so an unconfigured checkout behaves as it always has.

**Two optional external deps, both degrade gracefully and are reported on
`/status` rather than crashing:** the `agy` (Antigravity) CLI — *all* AI
features — and WeasyPrint's native Pango/Cairo libs — PDF/DOCX export only.

## 3. Backend — services (`backend/services/`)

- `db.py` — schema + migrations. Migration story is deliberately just
  `ALTER TABLE ADD COLUMN` driven by the `_POSTING_COLUMNS` dict; an existing
  `tracker.db` must keep working without a rebuild. All DB calls are async
  wrappers around a lock + threadpool.
- `matching.py` — cheap local keyword-overlap scoring, no embeddings, no agy.
  `posting_match_score` (0–100, ranks The Rough, ceiling `MATCH_CEILING=12`),
  `posting_match_terms` (the evidence behind it), `keyword_overlap_score`
  (raw fraction, used for the tailor pre-check).
- `job_sources.py` — provider adapters + normalization. Keyless/always-on:
  RemoteOK, Arbeitnow, Jobicy, Himalayas. Key-optional: **Jooble** (this is
  the one that reaches LinkedIn/Indeed/Naukri listings), **Adzuna**.
- `feed_ingest.py` — RSS/alert feeds + provider results → upsert into
  `seen_postings` keyed on `posting_hash`, scored on the way in.
- `agy_runner.py` — see §6, the sharp edges live here. Also stages each run's
  inputs in its own directory (`prepare_job_dir`) and holds a cross-process
  lock around the subprocess.
- `jobs.py` — the work queue. agy runs are enqueued, not awaited on the
  request. Separate database (`data/queue.db`) from `tracker.db` on purpose:
  operational state that can be truncated vs. the user's record.
- `filelock.py` — portable advisory lock (`fcntl` / `msvcrt`), so agy stays
  serialized across processes rather than just across coroutines.

**`backend/control/`** is a second entrypoint, not a second project: the
admin portal and user lifecycle for a multi-user host (`PLAN.md`). Run it
with `backend/.venv/python.exe -m control.app` → http://127.0.0.1:9000.
`store.py` owns `control.db` (users, audit), `provision.py` the
create/suspend/export/delete pipeline, `admin.html` the whole UI as one
self-contained page. It reads user databases read-only and never writes to
them.
- `docgen.py` — profile + tailored fields → resume PDF/DOCX + cover letter PDF.
- `scheduler.py` — 6-hour poll of every source, first pull ~10s after launch.
- `health.py` — every `/status` check, executed for real, no caching.
- `parser.py`, `calendar_sync.py`, `settings_store.py`, `logging_setup.py`.

## 4. API surface (all under `/api`, ~40 routes in 6 routers)

- `feeds.py` — **the job search.** `GET /jobs` (filter/sort/paginate, all in
  SQL), `GET /jobs/facets` (counts per filter value, computed against the
  *other* active filters), `POST /jobs/search` (live fetch), `GET/POST/DELETE
  /feeds`, `/feeds/builder`, `/feeds/sync`, `/rough/{id}/promote|dismiss|
  restore`, `GET/PUT /settings`. `GET /rough` is a legacy plain ranked list.
- `tailor.py` — `POST /tailor` validates and returns **202 + `job_id`**; the
  pipeline runs on the queue. `run_tailor_job` is the handler.
- `queue.py` — `GET /queue` (stats + recent), `GET /queue/{id}` (poll this),
  `DELETE /queue/{id}` (cancels only a job that hasn't started).
- `resume.py` — `/profile`, `/resume/import`, `/resume/master` (GET+POST),
  `/resume/extraction-status`.
- `tracker.py` — applications/contacts/interviews CRUD, `/dashboard/summary`,
  file downloads (`resume-file`, `docx-file`, `cover-letter-file`).
- `calendar.py` — ICS config/sync + interview *suggestions* (always confirmed
  by a human, never written straight into `interviews`).
- `status.py` — `/status`, `/status/logs`.

Middleware: CORS, GZip, `RequestLogMiddleware` (per-route p50/p95/max, feeds
`/status`). In Docker, Next rewrites `/api/*` to the backend, so nothing is
cross-origin and `BACKEND_ORIGIN` is a **build arg**, not runtime.

## 5. Data model (`seen_postings` is the one to know)

`seen_postings` doubles as the dedup index *and* the display row — a
posting's hash and its card are the same real-world thing. Columns:
`posting_hash` (UNIQUE), `source_feed`, `source`, `company`, `title`,
`posting_url`, `posted_date`, `summary`, `match_score`, `match_terms`,
`location`, `remote`, `employment_type`, `salary_min/max/currency`, `tags`,
`first_seen_at`, `last_seen_at`, `promoted`, `dismissed`.
`tags` and `match_terms` are JSON-encoded TEXT, decoded in the router.

Others: `applications` (status ∈ `Saved, Cut, Set, Interviewing, Rejected,
Offer`), `contacts`, `interviews`, `suggested_interviews`.

`profile.json`: `name`, `contact{email,phone,location,linkedin}`,
`summary_base`, `skills[]`, `roles[]` (each with a stable `id` the tailor
output must key against), `projects[]`, `certifications[]`, `education[]`,
`keywords[]`.

## 6. The `agy` integration — read before touching AI code

`agy -p` **silently produces nothing useful on stdout** when not attached to
a TTY, which is always true for a subprocess. So every call uses a
**file-handoff pattern**: write inputs to `workspace/`, delete any stale
output file, run agy with an instruction naming exactly which file to
read/write and saying not to rely on stdout, then read the result off disk
(300s timeout). Second sharp edge: agy sometimes writes into its own
`~/.gemini/antigravity-cli/scratch/` instead of its launch directory — fixed
by passing `--add-dir <workspace>` on **every** call. Without it the handoff
silently breaks. Env: `FACET_AGY_BIN`, `FACET_AGY_MODEL`, `FACET_AGY_TIMEOUT`.

## 7. The two flows that matter

**Import (once):** resume PDF/DOCX → mechanical parse to markdown → *user
reviews and corrects it* → saved as `master_resume.md` → background agy pass
extracts `profile.json`. Before `profile.json` exists, `/` shows `/welcome`;
after, `/` redirects to `/tailor`.

**Cut a Facet:** paste or promote a JD → validated and queued (202 + job id;
the browser polls `/api/queue/{id}` and shows position) → local keyword
pre-check (warns on a weak match, never blocks) → agy tailoring under a
truthfulness mode →
`tailored_fields.json` → render PDF/DOCX/cover letter into `data/exports/` →
row in `applications`. User reviews, then marks **Set This Facet** once they
have actually applied.

## 8. Non-negotiable product boundaries (design, not oversight)

- **Nothing scrapes or logs into a job platform.** Postings arrive only via a
  provider's public API, an aggregator's API, or a feed the user subscribed to
  themselves. A scraper would risk *the user's* account ban.
- **Nothing auto-submits an application.** The extension's selector format has
  no `submit_selector` field at all, and no `.click()` on a final control.
- **`profile.json` is the only source of truth about the user.** Employers,
  titles, and dates are never touched. Truthfulness modes: `strict` (default,
  only what's explicit) and `inferred_adjacent` (may claim a skill directly
  implied by a real accomplishment, always reported separately in
  `inferred_skills`, never silently folded into `matching_skills`).
- **Local-only.** No telemetry; keys live in `data/settings.json` or env vars
  and are only ever sent to the provider they belong to, never echoed back.

## 9. Frontend conventions

Pages: `/welcome` (landing), `/tailor` (cut), `/rough` (job search), `/cabinet`
(tracker + charts), `/stone` (profile/master resume), `/status`.
Shared: `components/ui/` (Button, Panel, Sheet, Segmented, EmptyState,
Skeleton, Toaster, NavBar, LoadingOverlay, AgyHealthBanner), `lib/api.ts`
(typed client + `ApiError`/`isAborted`), `lib/useJobs.ts`, `lib/useStatus.ts`,
`lib/format.ts`, `lib/useToasts.tsx`, `lib/handoff.ts` (sessionStorage
Rough→Tailor handoff).

**Design system — "cool graphite", enforced by tokens in `app/globals.css`:**
four neutral surface steps; **one** accent (indigo `#4c7ef3`) for the primary
action and current state only; green/amber/red reserved strictly for status.
If it isn't reporting state, it isn't coloured. Depth = 1px border + surface
step — no glows, no coloured shadows, no gradient text, no hover-scale. Inter
for UI, JetBrains Mono for numbers. Metadata is middot-separated plain text,
not a wall of pills; badges are rare and mean something. 32px controls, 8px
grid, 13–14px body. Motion 100–200ms, functional only, all collapsing under
`prefers-reduced-motion`.

**Performance is treated as a design constraint:** filter/sort/paginate in
SQLite so the browser holds one page; `content-visibility` on long lists;
debounced input with superseded requests aborted, not raced; optimistic
dismiss with undo. The landing page's WebGL gem (~600KB of three/gsap) was
deliberately replaced with inline SVG + CSS.

## 10. Testing — there is no framework, on purpose

Each non-trivial module carries one runnable check:

```
backend/.venv/python.exe -m services.paths           # path resolution + env overrides
backend/.venv/python.exe -m services.filelock        # cross-process exclusion (spawns a child)
backend/.venv/python.exe -m services.jobs            # queue, claiming, reconciliation
backend/.venv/python.exe -m services.agy_runner      # per-job input staging
backend/.venv/python.exe -m control.provision        # full user lifecycle, temp root
backend/.venv/python.exe -m services.job_sources     # parsing, offline
backend/.venv/python.exe -m services.matching        # scoring
backend/.venv/python.exe -m services.logging_setup   # ring buffer + metrics
backend/.venv/python.exe -m services.health          # every status check
backend/.venv/python.exe scripts/test_feed_dedup.py  # dedup, dismissals
backend/.venv/python.exe scripts/test_health.py      # /api/status contract
cd frontend && npm run check                         # salary/date formatting
cd frontend && npx tsc --noEmit && npm run lint && npm run build
```

New non-trivial logic adds one `demo()`/`assert` check in the same style.
Don't introduce pytest/jest/vitest without being asked.

## 11. Gotchas that will bite an agent immediately

1. **Use `backend/.venv/python.exe`** — bare `python` on this machine is a
   3.8-era interpreter and dies on `set[str]` subscripting.
2. Port 8000/3000 may already hold a running instance; `bind` fails with
   WinError 10048. Check before launching another.
3. `agy` may be absent/unauthenticated. Everything except tailoring and
   extraction must still work; `/status` reports it.
4. Migrations are additive-only via `_POSTING_COLUMNS`. Never rewrite the
   table; existing user DBs must survive.
5. Live DB is real user data (~828 postings). `workspace/` and `data/` are
   never to be deleted without explicit permission.
6. **Known open bug:** the same posting appears twice (e.g. "Senior Python
   Engineer, EPAM") — `posting_hash` isn't deduping one job arriving from two
   sources. Unfixed; next pass.
