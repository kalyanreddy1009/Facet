# Facet

A local job-search assistant. One stone — a permanent, honest record of your
real background — cut into a tailored resume, cover letter, and recruiter
pitch for each job you apply to. Runs entirely on your machine.

## Prerequisites

You only need two things on PATH; the launcher installs everything else.

- **Python 3.10+** — used both to run the launcher and for the backend venv.
- **Node.js 18.17+** — for the Next.js frontend.

Two dependencies can't be auto-installed and are only checked/reported at
launch (the app still runs without them, with the relevant feature disabled):

- **WeasyPrint's native GTK/Pango libraries** — needed only for PDF/DOCX
  export. `pip install weasyprint` alone isn't enough on Windows; the reliable
  path is a conda-forge env (`conda create -p backend/.venv -c conda-forge
  python=3.10 weasyprint -y`), or `brew install pango` on macOS / the distro's
  pango+cairo packages on Linux. Without them, everything works except export.
- **The `agy` (Antigravity) CLI**, installed and authenticated with quota —
  needed for all AI features (tailoring, profile extraction). Without it the
  app runs, but those actions return a clear error. Check with `agy --version`.

## First run

One command — installs deps, initializes the DB, and launches both servers:

```
start.bat          (Windows)
./start.sh         (macOS / Linux)
python run.py      (any platform, directly)
```

First run creates `backend/.venv`, `pip install`s the backend, `npm install`s
the frontend, initializes `tracker.db`, builds the frontend, then starts the
backend (FastAPI, :8000) and frontend (Next.js, :3000). Ctrl+C stops both. An
existing `backend/.venv` (e.g. the conda-forge one above) is reused, never
recreated.

| Flag | What |
|---|---|
| *(none)* | Production build, then serve. The default. |
| `--dev` | `uvicorn --reload` + `next dev`. For working on Facet itself. |
| `--build` | Discard the previous build and rebuild before serving. Use after a dependency upgrade — a stale `.next` fails in confusing ways. |
| `--setup` | Install dependencies and exit. |

Where data lives is configurable: set `FACET_DATA_DIR` and
`FACET_WORKSPACE_DIR` to move `data/` and `workspace/` outside the repo.
Unset, both default to the repo, which is what you want on one machine.

On first visit, `http://localhost:3000` shows the landing page — there's no
`profile.json` yet, so there's nothing to work with. Import your resume
(PDF or DOCX) to get started: it's mechanically parsed into markdown, you
review/correct that markdown, save it as `master_resume.md`, and a
background `agy` pass extracts it into `profile.json` — the structured,
fixed scaffold every tailored resume is built from afterward. Once
`profile.json` exists, visiting `/` redirects straight to `/tailor`; the
landing page stays reachable at `/welcome`.

## Daily usage

1. Paste a job description at `/tailor` (or promote one from The Rough —
   see below), pick a company/role, choose a truthfulness mode, and cut a
   Facet.
2. Review the result — Clarity Score, which skills matched vs. were
   inferred vs. are missing, the tailored bullets, cover letter, recruiter
   pitch. Nothing here is final until you've looked at it.
3. In the Cabinet, click **Set This Facet** once you've actually applied.
4. The Rough is the job search: postings gathered from every configured
   source, deduplicated and ranked against your Stone. Search by role,
   company, skill or keyword, and filter by location, remote/on-site, date
   posted, source, employment type, minimum salary, and how well a posting
   matches your Stone. **Tailor** on any card carries the posting straight
   into the cutting flow with the fields already filled in.
5. To use autofill on a real application: load `extension/` unpacked in
   Chrome (`chrome://extensions` → enable Developer Mode → **Load
   unpacked** → select the `extension/` folder). It fills recognized fields
   on Greenhouse/Lever postings and stops — it never submits anything.

### Where postings come from

Open **Sources** on The Rough. There are three kinds of source, and the app
works with none of them configured — the keyless ones are always on.

**1. Public job APIs (no key, always on).** RemoteOK, Arbeitnow, Jobicy and
Himalayas are queried directly through their documented public APIs. Good
coverage of remote and tech roles.

**2. Aggregator APIs (free key, optional).** Paste a key under Sources → API
keys and that provider joins every search:

- **Jooble** — this is the one that reaches **LinkedIn, Indeed and Naukri**
  listings. Their index already contains postings syndicated from those
  boards, and hands them over through their own API. Free key at
  `jooble.org/api/about`.
- **Adzuna** — strong country-specific coverage including India. Free key at
  `developer.adzuna.com`; set the two-letter country code alongside it.

#### Adding a Jooble key (LinkedIn / Indeed / Naukri postings)

1. Get a free key at `jooble.org/api/about`.
2. Open `http://localhost:3000/rough` → **Sources** (top right) → **API keys**.
3. Paste it into **Jooble** and press **Save keys**. The field is a password
   input; the value is never rendered back to you afterwards.
4. Press **Search all boards** with a real query and location, e.g.
   `python developer` / `Bengaluru`.

Confirm it actually worked — a wrong or not-yet-activated key fails at the
provider and simply looks like "no new jobs":

- `/status` → **Job sources** → `Provider: jooble` should read **Operational**
  rather than *Not configured*, and name a posting count.
- Job cards from it are labelled `Jooble · linkedin`, `Jooble · naukri` and so
  on, so you can see which board a posting was syndicated from.
- `curl http://localhost:8000/api/settings` reports `"jooble_configured": true`
  without ever echoing the key itself.

If it stays at zero: keys are sometimes not live immediately after signup, and
Jooble's free tier is rate-limited — the sync report and `/status` will name
the provider and the reason rather than failing silently.

**What to expect.** Jooble indexes postings *syndicated from* those boards. It
is not a mirror of what you would see logged into LinkedIn, and it never will
be — no tool that stays on the right side of the line in "Where the line is"
can be. For fuller Naukri coverage, pair it with a Naukri job alert from
Sources → Platforms. If you are job-hunting in India, add Adzuna alongside it
with `adzuna_country: in` (already the default).

#### Where keys are stored

Keys are written to `data/settings.json` on your machine and are only ever
sent to the provider they belong to. The root `.gitignore` excludes that file
(along with `data/logs/`, `tracker.db` and everything in `workspace/`), so a
`git init` here won't commit your key — but it's still a credential: don't
paste it into a chat, an issue, or a log.

To keep a key off disk entirely, set an environment variable instead — these
override the file:

```
setx JOOBLE_KEY "your-key"          # Windows, then restart with start.bat
export JOOBLE_KEY="your-key"        # macOS / Linux
```

`ADZUNA_APP_ID` and `ADZUNA_APP_KEY` work the same way. Environment variables
only reach processes started *after* they are set, so relaunch the app.

To revoke: clear the value in `data/settings.json` (or delete the file), and
rotate the key on the provider's own dashboard — removing it locally does not
invalidate it.

**3. RSS / job-alert feeds you've subscribed to** (`data/feeds.json`):

```json
[{ "url": "https://...", "label": "Human-readable name" }]
```

Sources → Platforms builds the saved-search URL for LinkedIn, Naukri,
Indeed, We Work Remotely, Jobicy, Himalayas and Google Alerts from whatever
you last searched for. Feeds tagged **RSS** are added with one
click. LinkedIn and Naukri are tagged **Alert** instead: they only hand out a
feed once *you* subscribe on the platform, which is exactly the boundary this
app keeps (see below).

Feeds are fetched with a browser User-Agent and parsed from the bytes, rather
than letting feedparser fetch them — several boards reject unknown agents,
and doing it this way means a rejected request reports its real HTTP status
(410 gone, 403 blocked, 429 rate-limited) on `/status` instead of surfacing
as a baffling XML parse error.

Every source is polled on a 6-hour schedule, with the first pull ~10s after
launch. **Sync** on The Rough runs the same pull on demand, and **Search all
boards** runs it with your current search terms pushed through to the
providers that accept a query. A provider that's down, rate-limited or
unconfigured costs you that provider's results and nothing else — the sync
report names anything that didn't answer.

## Running in Docker

Nothing in the compose setup is tied to a particular machine — no host paths,
no baked-in addresses. It runs the same on Windows, macOS and Linux.

```
cp .env.example .env        # optional; every value has a default
docker compose up --build
```

Then open `http://localhost:3000`. `docker compose down` stops it;
`docker compose down -v` also deletes your data.

**How it's wired.** The browser only ever talks to the frontend's origin, and
Next proxies `/api/*` to the backend over the compose network. So no API host
or port is baked into the JS bundle, nothing is cross-origin (CORS is never
consulted), and the backend doesn't have to be reachable from the browser at
all — port 8000 is published only for direct API access and debugging.

**Your data lives in named volumes** (`facet-data`, `facet-workspace`), not
bind mounts — they behave identically across the three host OSes and avoid the
permission and line-ending problems bind mounts cause. `tracker.db`, your
Stone and your exports survive `up --build`.

**Ports** are `FRONTEND_PORT` / `BACKEND_PORT` in `.env` if 3000 or 8000 are
taken. Only the host side moves.

**One thing to know if you change the topology:** Next resolves rewrite
destinations at *build* time into `routes-manifest.json`, so `BACKEND_ORIGIN`
is a **build arg**, not a runtime variable. Setting it at runtime silently
does nothing and every `/api/*` call 404s. Compose passes it correctly; if you
build the image by hand, use
`--build-arg BACKEND_ORIGIN=http://your-backend:port`.

PDF/DOCX export is *easier* here than on Windows: the Pango/Cairo libraries
the backend image installs are a single `apt-get`, with none of the GTK DLL
setup the native Windows install needs.

### agy in a container

The AI features (tailoring, profile extraction) shell out to the `agy` CLI.
Everything else — job search, filters, the Cabinet, `/status`, the extension —
works without it, and `/status` reports it as unavailable rather than failing
obscurely. So the default compose setup runs fine with no agy at all.

**A container cannot call a CLI installed on your host.** `agy_runner.py` runs
`subprocess.run([...])`, which resolves inside the container's filesystem;
there is no Docker flag that changes this. To use agy in Docker it has to be
*in the image*, which means two things:

1. **Install it.** Add a layer to `backend/Dockerfile` that installs the Linux
   build of Antigravity. If it doesn't land on `PATH`, point `FACET_AGY_BIN`
   at it. Note that a host install is often a platform-native binary — a
   Windows `.exe` cannot simply be copied into a Linux image.
2. **Give it credentials.** Authenticate once, then set `AGY_CONFIG_DIR` in
   `.env` to the directory holding that login; compose mounts it at
   `/home/facet/.gemini`. Use an **absolute path** — compose does not expand
   `~`. On Windows use forward slashes (`C:/Users/You/.gemini`). Left unset, a
   throwaway volume is used, which is what you want if you aren't using agy.

Whether a login copied from a host works elsewhere depends on Antigravity, not
on Facet. If its token is device-bound you'll need to authenticate inside the
container instead. `$HOME` in the image is writable and owned by the runtime
user precisely so agy can write its credentials and scratch directory.

`FACET_AGY_MODEL` and `FACET_AGY_TIMEOUT` are also environment-configurable.

## The `agy` stdout limitation

`agy -p` (print/non-interactive mode) silently produces nothing useful on
stdout when it isn't attached to a real terminal — which is always true for
a subprocess launched by the backend. Every `agy` call in this app therefore
uses a **file-handoff pattern** instead (`backend/services/agy_runner.py`):
write the input file(s), delete any stale output file, run `agy` with an
instruction that says exactly which file to read/write and explicitly not
to rely on stdout, then read the output back from disk after the process
exits (300s timeout, killed and reported cleanly if exceeded).

A second, less-documented sharp edge turned up during this build: `agy`
sometimes writes to its own internal `~/.gemini/antigravity-cli/scratch/`
folder instead of the directory it was actually launched in — reproduced
repeatedly, regardless of model or how `agy` was invoked. The fix is
`--add-dir <workspace>`, passed on every call, which explicitly tells `agy`
to trust that directory. Without it, the file-handoff pattern above
silently breaks.

## Where the line is (and why)

- **No code path scrapes or authenticates against a login-gated job
  platform.** Postings arrive three ways, all first-party: a provider's own
  public API, an aggregator's own API, or a feed you subscribed to yourself.
  That's the same category of access as an email newsletter, not a scraper.
  A LinkedIn/Indeed/Workday scraper would put *your* account at risk of a
  ban — a cost that lands entirely on you, not on whoever built this — and
  breaks every time the markup moves. So instead of scraping LinkedIn and
  Naukri, Facet reaches those listings through Jooble's index and builds the
  saved-search URL so you can subscribe on the platform itself.
- **No code path programmatically submits an application.** The
  Apply-Assist extension's selector-map format has no `submit_selector`
  field at all, and nothing in `content_script.js` calls `.click()` or
  dispatches a submit event on a final control. It fills what it recognizes
  and stops; you read it, fix anything wrong, and click Submit yourself.
  An application sent with no human review is a cost that lands on you,
  not on whoever built this — so that path doesn't exist, on purpose.
- **`profile.json` is the only source of truth about you.** The tailoring
  pipeline never invents a skill, employer, title, date, or accomplishment.
  The **truthfulness mode** toggle on `/tailor` controls how far it can go
  in surfacing real experience: *strict* (default) only claims what's
  explicitly in your Stone; *infer adjacent skills* additionally allows
  claiming a skill genuinely implied by a real accomplishment (e.g. "REST
  APIs" from a bullet about building an API-backed dashboard) — always
  flagged separately as inferred, never silently folded in, so you can
  remove anything you're not comfortable standing behind before it goes
  out. Employers, titles, and dates are never touched by either mode.

## Service status (`/status`)

A live dashboard over every subsystem the app depends on. Nothing on it is
cached or assumed — each row executes real work and reports its own latency:

- **Core** — process uptime, SQLite connectivity, `PRAGMA integrity_check`,
  schema/migration state, WAL and DB size, free disk, and the scheduler with
  each job's next run time.
- **Sources** — every aggregator provider (an unconfigured Adzuna/Jooble
  reads *Not configured*, which is not a failure) and **every subscribed RSS
  feed individually**, with its parse error if it has one.
- **AI engine** — `agy` presence and version, whether a run is in flight,
  `profile.json` validity, last extraction result.
- **Documents** — WeasyPrint importability, the three templates, and the
  exports directory (probed by actually writing and deleting a file).
- **Data** — record counts, dismissed vs promoted, oldest/newest posting.

Plus per-endpoint traffic (calls, errors, p50/p95/max) measured in-process,
and the recent warnings and errors with expandable tracebacks. `overall` is
*down* only if a Core check fails, *degraded* if anything else does.

`GET /api/status` returns the whole report as JSON; `GET /api/status/logs`
returns recent entries. The report is assembled concurrently and makes no
live provider calls, so it answers in a couple of seconds.

## Logs

The app writes a rotating log to `data/logs/facet.log` (2 MB × 5). Every
request is logged with its route template, status and duration, and the
global exception handler records full tracebacks. The last 200 entries at
WARNING or above are also held in memory and surfaced on `/status`.

## Checks

No test framework — each non-trivial module carries one runnable check:

```
backend/.venv/python -m services.job_sources     # parsing/normalizing, offline
backend/.venv/python -m services.matching        # match scoring
backend/.venv/python -m services.logging_setup   # ring buffer + metrics
backend/.venv/python -m services.health          # every status check
backend/.venv/python scripts/test_feed_dedup.py  # dedup, dismissals, staleness
backend/.venv/python scripts/test_health.py      # /api/status contract
cd frontend && npm run check                     # salary/date formatting
cd frontend && npx tsc --noEmit && npm run lint && npm run build
```

## Interface

Cool graphite. Four neutral surface steps carry the interface; **one** accent
(indigo `#4c7ef3`) marks the primary action and the current state, and green /
amber / red are reserved strictly for reporting status. If a thing isn't
reporting state, it isn't coloured.

The rules the token layer enforces, and every component follows:

- Depth is a 1px border and a surface step. No glows, no coloured shadows, no
  gradient text, no hover-scale.
- One typeface (Inter) for the UI, one (JetBrains Mono) for numbers and
  identifiers. Hierarchy comes from size and weight only.
- Metadata is plain middot-separated text, not a wall of pills. Badges are
  rare and mean something.
- 32px controls on an 8px grid; 13–14px body text.
- Motion is functional and short (100–200ms, ease-out) — a sliding tab
  indicator, a counting score ring. Anything that draws attention to itself
  is gone. Everything collapses under `prefers-reduced-motion`.

Performance is a design constraint, not an afterthought. Filtering, sorting
and pagination happen in SQLite, so the browser holds one page of rows no
matter how many postings have accumulated; long lists use
`content-visibility` so offscreen rows cost nothing to render; search input
is debounced and every superseded request is aborted rather than raced. The
landing page's WebGL gem and its ~600KB of `three`/`gsap` were replaced with
inline SVG and CSS that do the same job for nothing.

## Known deviations from the original spec

- Built against Python 3.10.6, not 3.11+ (see Prerequisites).
- Four pieces the spec described as "build from `X.jsx`/`X.html` (alongside
  this prompt)" — the resume template, Cabinet dashboard, landing page, and
  gem background — had no such reference file provided, so they were
  designed directly from the spec's written description instead. The gem
  background has since been dropped entirely (see Interface).
- The spec's Rough was a plain ranked feed list. It's now a full job search
  across multiple providers, with server-side filtering. `GET /api/rough`
  still returns the old plain ranked list for anything relying on it.
