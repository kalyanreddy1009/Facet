# Facet — multi-user host deployment plan

Target: up to 10 people on one Oracle Always Free ARM VM (2 vCPU / 12 GB /
200 GB), behind Cloudflare Tunnel + Access on your own domain, sharing one
`agy` binary. Admin portal manages the whole user lifecycle from inside the
app. Cost: $0.

Read alongside `CONTEXT.md` (what the app is) and `AUTONOMY.md` (how to work
here). This document is the plan of record; `CHANGELOG.md` records what
actually shipped.

---

## 0. The one decision everything else follows from

**Each user gets their own process group and their own SQLite database.
Facet's application code stays single-user.**

The alternative — real multi-tenancy, with `user_id` on every table and
ownership checks on ~40 routes — is 2–3 weeks of work and rewrites the
`seen_postings` schema. This plan does not do that.

Instead, the trust boundary moves *outward*: Cloudflare Access decides who
you are, the hostname decides which stack you reach, and inside that stack
there is still exactly one user — which is the assumption the code was
written under and already satisfies.

### What this buys

| Problem in a shared-process design | Status here |
|---|---|
| `user_id` on `applications`/`contacts`/`interviews` | Not needed |
| IDOR checks on ~40 routes | Not needed |
| `seen_postings` split into shared + per-user state | Not needed |
| Per-user match scoring fan-out at ingest | Not needed |
| `resume_path` arbitrary-file-read (PATCH-able path → `read_bytes`) | Not exploitable across users; still fixed in Phase 1 |
| `data/exports/{company}.pdf` filename collision | Not possible — separate directories |
| `workspace/job_description.md` overwrite race | Fixed structurally by per-job dirs (Phase 1) |
| `_extraction_state` module global shared across users | Not shared — separate processes |
| One global SQLite connection behind one lock | Per-user connection; contention is per-person |

### What it costs

- ~10× feed polling (4 keyless providers × 4 polls/day × 10 users — trivial)
- ~10× posting storage (2.3 MB × 10 = 23 MB — trivial against 200 GB)
- No shared posting corpus, so no cross-user analytics
- Onboarding must be automated, which is exactly what the admin portal is for

### It is not a dead end

Each user keeps a standalone `tracker.db` with the *current* schema. If you
ever outgrow this, merging N databases into one multi-tenant schema is an
`INSERT … SELECT` with a `user_id` column added — a script, not a rewrite.
Choosing this now does not foreclose that later.

---

## 1. Target architecture

Reflects D9 and D10, decided while building Phase 3 — the backend runs
natively and cloudflared routes `/api` by path.

```
                        Cloudflare (free tier)
                        Tunnel + Access + TLS
   admin.facet.example       ──► 127.0.0.1:9000   control plane [you only]
   alice.facet.example/api/* ──► 127.0.0.1:8101   alice backend [alice@…]
   alice.facet.example/*     ──► 127.0.0.1:3101   alice frontend
   bob.facet.example/api/*   ──► 127.0.0.1:8102   bob backend   [bob@…]
   bob.facet.example/*       ──► 127.0.0.1:3102   bob frontend

╔══════════════ Oracle VM, all processes as user `facet` ══════════════╗
║                                                                      ║
║  NATIVE (systemd)                                                    ║
║    cloudflared.service      no inbound ports open, anywhere          ║
║    facet-control.service    admin API + UI                           ║
║      ├── provisioner        systemd + compose per user               ║
║      ├── purge loop         expired accounts, daily                  ║
║      └── backup loop        backup + prune + verify, daily           ║
║    facet-api@alice.service  uvicorn, calls agy directly              ║
║    facet-api@bob.service    ditto — contend on the flock             ║
║    agy                      binary + ~/.gemini credentials           ║
║                                                                      ║
║  DOCKER (one compose project per user, frontend only)                ║
║    facet-alice_web  127.0.0.1:3101→3000                              ║
║    facet-bob_web    127.0.0.1:3102→3000                              ║
║                                                                      ║
║  /srv/facet/                                                         ║
║    control.db                 users, audit                           ║
║    users/alice/data/          tracker.db, queue.db, settings, exports║
║    users/alice/workspace/     profile.json, master_resume.md, RULES  ║
║    users/alice/data/jobs/     ephemeral agy scratch, swept           ║
║    backups/  exports/  deleted/                                      ║
╚══════════════════════════════════════════════════════════════════════╝
```

### Why the backend is native, not containerised

`agy` authenticates against `~/.gemini`, which belongs to a specific OS user
on a specific host. A container cannot call a host CLI — `.env.example`
documents this at length.

Containerising the backend anyway would mean handing agy work back to the
host: a second queue layer, a remote mode in `run_agy`, and job directories
mounted into both sides. That is a great deal of machinery to isolate
instances of the same trusted application from each other. Native, the
cross-process lock from Phase 1 already serializes every instance against the
one CLI, and Docker keeps the frontend, where a reproducible node build is
real value.

The provisioner also needs the Docker socket, which a container would have to
be given anyway.

**Consequence, stated plainly:** `facet-control` runs as a user in the
`docker` group, which is effectively root on that box. This is acceptable
because it is a single-admin machine and the admin UI is reachable only
through a one-email Cloudflare Access policy — but it is a real privilege and
should not be casually widened. Upgrade path if that ever stops being
acceptable: control writes a desired-state file, and a separate root-owned
systemd path unit applies it.

### Why one control process, not three

The provisioner is bursty and rare, the worker is continuous, the sweeper is
hourly. Three asyncio tasks in one process is one systemd unit to run, one
log to read, one thing to restart. agy is invoked via
`asyncio.create_subprocess_exec`, so a 300-second run never blocks the admin
UI.

---

## 2. Request lifecycle: cutting a facet

This is the flow that dictates the queue design, so it is worth having
explicit.

```
alice's backend (native)
   POST /api/tailor  { job_description, … }      ← routed by path via the tunnel
   INSERT INTO jobs (kind, payload, status='queued')  → users/alice/data/queue.db
   202 { job_id }

alice's browser
   GET /api/queue/<id>  every 1.5s   (its own row only)

alice's queue worker  (in-process, one job at a time)
   claim oldest queued row  (one UPDATE … RETURNING — atomic)
   mkdir users/alice/data/jobs/<id>/
   copy in: alice's master_resume.md, profile.json, RULES.md
   write:   job_description.md          ← staged AFTER the flock is held,
                                          in an empty dir: the overwrite
                                          race cannot occur by construction
   agy -p <instruction> --add-dir …/jobs/<id> --mode=accept-edits
        └─ the flock here is what serializes alice against bob
   read …/jobs/<id>/tailored_fields.json          ← the response
   render PDF/DOCX/cover letter (WeasyPrint, no agy)
   INSERT INTO applications
   UPDATE jobs SET status='done', result=<json>
   rm -rf …/jobs/<id>/

alice's browser
   next poll sees status='done' and reads `result`
```

Four properties worth noting:

1. **The result comes off disk, not stdout.** `agy -p` produces nothing
   usable on stdout when not attached to a TTY, which is always true from a
   subprocess. The instruction names the output file and says not to rely on
   stdout. Exit code alone is not a success signal — a missing or
   unparseable file is a failed job, and the error text is stored on the row
   so the user sees a real message rather than an eternal spinner.

2. **`--add-dir` is load-bearing.** Without it agy sometimes writes into
   `~/.gemini/antigravity-cli/scratch/` instead of its launch directory and
   the handoff silently breaks. With one OS user shared by ten people, that
   scratch directory is shared too — which makes the per-job `--add-dir`
   matter more here than it does locally.

3. **Each user polls only their own row.** No broadcast, no shared result, no
   duplicated agy work.

4. **The 100-second Cloudflare ceiling is respected.** A blocking 300-second
   request would die with a 524 regardless of what the VM does. Polling
   sidesteps it, survives page reloads, and gives queue position for free.
   (SSE would also work — the 100s limit is time-to-first-byte, not total
   duration — but it dies on reconnect and still needs the queue underneath,
   so it is not worth the extra transport.)

**Throughput ceiling, stated up front:** one agy binary at a 300-second
worst case is roughly 12 cuts/hour. Fine for ten people cutting a few
resumes a week. The UI must show queue position or the wait reads as a bug.

---

## 3. New data: `control.db`

**`data/tracker.db` is not modified in any way by this plan.** No new
columns, no new tables, no schema migration. The additive-only
`_POSTING_COLUMNS` rule stays untouched, and every existing query keeps
working because every instance is still single-user.

All new state lives in a separate database at `/srv/facet/control.db`, owned
solely by `facet-control`.

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,      -- never recycled (see §4, ports)
  email         TEXT UNIQUE NOT NULL,     -- matches the Access policy
  slug          TEXT UNIQUE NOT NULL,     -- filesystem + compose project name
  display_name  TEXT,
  status        TEXT NOT NULL,            -- provisioning|active|suspended|
                                          -- deprovisioning|deleted
  web_port      INTEGER NOT NULL,
  api_port      INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  deleted_at    TEXT,                     -- soft delete; purge after grace
  last_seen_at  TEXT
);

CREATE TABLE jobs (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  kind         TEXT NOT NULL,             -- tailor | extract_profile
  status       TEXT NOT NULL,             -- queued|running|done|failed|cancelled
  payload      TEXT NOT NULL,             -- JSON
  result       TEXT,                      -- JSON (tailored_fields)
  error        TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  queued_at    TEXT NOT NULL,
  started_at   TEXT,
  finished_at  TEXT,
  worker_pid   INTEGER                    -- for crash reconciliation
);
CREATE INDEX idx_jobs_queue ON jobs(status, queued_at);
CREATE INDEX idx_jobs_user  ON jobs(user_id, queued_at DESC);

CREATE TABLE audit (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL,
  actor      TEXT NOT NULL,               -- admin email from the Access JWT
  action     TEXT NOT NULL,               -- user.create, user.delete, job.cancel…
  target     TEXT,
  detail     TEXT
);
```

**Crash reconciliation.** On startup the worker marks any `running` job whose
`worker_pid` is not alive as `failed` with a clear error. Without this a
control-plane restart mid-cut leaves a job stuck forever and the user's
browser polls a spinner into the heat death of the universe.

**Job claiming is a single UPDATE**, not SELECT-then-UPDATE. There is only
one worker today, but making the claim atomic costs nothing and means a
second worker cannot double-run a job if one is ever added.

---

## 4. The admin portal

Served by `facet-control` at `admin.facet.example`, gated by a Cloudflare
Access policy naming only your email. It is a separate Next.js app (or a set
of routes in a minimal one) reusing the existing `components/ui/` primitives
and the cool-graphite token layer, so it looks like Facet and not like a
different product.

### 4.1 Users

| Column | Notes |
|---|---|
| Email / name | Email is the Access identity — it is the join key |
| Status | provisioning / active / suspended / deprovisioning |
| Disk | `data/` + `workspace/` size, sparkline over 30 days |
| Postings | row count in their `seen_postings` |
| Applications | row count |
| Cuts (30d) | jobs completed |
| Last seen | from the request log |
| Actions | Suspend · Export · Delete |

**Add user** — one field (email), optional display name. Everything else is
derived.

**Suspend** — `docker compose stop` + disable the Access policy. Data
untouched. Reversible in one click. This is the button you actually want when
someone stops using it; deletion is rarely the right answer.

**Export** — produces a zip of `workspace/` + a `VACUUM INTO` copy of
`tracker.db` + `exports/`. Always offered before deletion, and available at
any time. This is what makes deletion safe to offer at all.

### 4.2 Provisioning — what "add a user" actually does

Executed as an ordered, resumable pipeline. Each step is idempotent and
recorded, so a failure at step 6 does not leave a half-built user with no way
forward: the admin sees exactly which step failed and can retry from there.

| # | Step | Rollback |
|---|---|---|
| 1 | Insert `users` row, status `provisioning`; allocate `id` | delete row |
| 2 | `mkdir -p /srv/facet/users/<slug>/{data,workspace,data/exports}` | rmdir if empty |
| 3 | Seed `workspace/RULES.md` from `templates/` | rm |
| 4 | Run `init_db` against `users/<slug>/data/tracker.db` | rm |
| 5 | Assign ports: `web = 3100 + id`, `api = 8100 + id` | — |
| 6 | Write `/srv/facet/users/<slug>/.env` | rm |
| 7 | `docker compose -p facet-<slug> up -d` | `down -v` |
| 8 | Append tunnel ingress rule, reload `cloudflared` | remove rule, reload |
| 9 | Create Cloudflare Access application + policy via API | delete app |
| 10 | Health-check `http://127.0.0.1:<web_port>/`; set status `active` | — |

**Ports are derived from the user id and ids are never recycled.** This
avoids the nastiest possible bug in this design: a deleted user's port being
reassigned while a stale container or a cached tunnel rule still points at
it, silently handing one person's Facet to another. Never reusing ids makes
that unrepresentable.

**Steps 8–9 need the Cloudflare API.** A scoped API token (Access: Apps
Write, Tunnel: Write) stored in the control plane's environment. If you would
rather not automate Cloudflare at first, the pipeline supports a **manual
mode**: steps 8–9 become a checklist the admin UI displays with the exact
values to paste, and the user goes `active` once you confirm. Phase 3 does
manual mode first and automates second, so a Cloudflare API problem never
blocks the rest of the system.

### 4.3 Deprovisioning — what "delete a user" actually does

Deleting a user destroys their real career record. `AUTONOMY.md` forbids
deleting user data without asking, and that rule does not stop applying just
because the deletion is now a button.

1. Admin clicks Delete → dialog requires typing the user's **email** to
   confirm (not "yes", not a checkbox)
2. An export bundle is generated automatically and offered for download
   **before** anything is removed
3. `docker compose -p facet-<slug> down` (containers stopped, volumes kept)
4. Access policy deleted, tunnel ingress rule removed
5. Data directory **moved** to `/srv/facet/deleted/<slug>-<timestamp>/` —
   not deleted
6. `users.status = 'deleted'`, `deleted_at` set
7. Purged permanently after a configurable grace period (default **30 days**)
   by the retention sweeper, which logs the purge to `audit`

Until step 7, "Undo" fully restores the user. The grace period is the whole
point: the irreversible step is separated from the click by 30 days.

### 4.4 Queue dashboard

- **Now running** — user, kind, elapsed, live tail of the agy stderr, Cancel
- **Queued** — ordered, with each entry's projected start time
- **History** — last 200, filterable by user and status, with the error text
  inline on failures and a Retry action
- **Metrics** — cuts/day, p50 and p95 wait, p50 and p95 run duration, failure
  rate by reason, agy availability over time
- **Health** — agy version and auth state, flock holder, disk free, per-user
  container up/down

Failure reasons are worth bucketing explicitly, because they have different
fixes: `timeout`, `agy_missing`, `agy_unauthenticated`, `no_output_file`,
`bad_json`, `cancelled`. A dashboard that says "3 failures" is noise; one
that says "3 failures, all `no_output_file`" points straight at `--add-dir`.

### 4.5 Storage

Per-user disk broken down by `tracker.db` / `exports/` / `workspace/` /
logs, total against the 200 GB, projected fill date, and a manual "Run
retention sweep now" button that reports what it *would* delete before
deleting it.

---

## 5. Retention

Space is not actually tight — ten users at current sizes is well under a
gigabyte — but exports accumulate forever and nothing currently removes them.

| What | Rule | Default |
|---|---|---|
| `data/exports/*` **referenced** by an `applications` row | never deleted | — |
| `data/exports/*` **unreferenced** | delete after N days | 30 days |
| `/srv/facet/jobs/<id>/` | deleted on completion; orphans swept | hourly |
| `queue.db` `jobs` rows (per user) | delete completed/failed after N days | 90 days |
| `control.db` `audit` rows | never auto-deleted | — |
| `data/logs/` | already rotating, 2 MB × 5 per user | unchanged |
| `/srv/facet/deleted/*` | purge after grace period | 30 days |
| `workspace/` | **never touched** | — |
| `tracker.db` | **never touched** | — |

The referenced/unreferenced distinction is what makes this safe. A PDF
attached to a real application is part of the user's record; a PDF from a cut
they abandoned is scratch. The sweep resolves references by reading each
user's `applications` table, so it can never orphan a live row.

Rules are per-deployment settings on the admin portal, and the sweep always
runs dry first and logs what it removed.

**Also add a per-user soft quota** (default 2 GB). Crossing it warns on the
admin dashboard; it does not delete anything automatically. Automatic
deletion under pressure is how you lose data you meant to keep.

---

## 6. Making the app host-clean

The user's request: *"make this application easy to run on the host machine,
I can see hardcoded values for this local machine, and no dev env or
processes, just clean application-related stuff."*

### 6.1 Paths — the actual blocker

Eight modules independently compute paths from their own file location:

```
backend/services/db.py:14           DB_PATH  = …/data/tracker.db
backend/services/health.py:38-40    ROOT, EXPORTS_DIR
backend/services/docgen.py:16       TEMPLATES_DIR
backend/services/agy_runner.py:17   WORKSPACE
backend/services/feed_ingest.py:20  ROOT
backend/services/calendar_sync.py:19 ROOT
backend/routers/resume.py:14-16     WORKSPACE, MASTER_RESUME_PATH, PROFILE_PATH
backend/routers/tailor.py:25-26     WORKSPACE, EXPORTS_DIR
```

Every one is `Path(__file__).resolve().parent.parent.parent / …`, so data
*must* live inside the repo. That is fine for one laptop and wrong for a
server where each user's data lives at `/srv/facet/users/<slug>/`.

**Fix — one new module, `backend/services/paths.py`:**

```python
ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR      = Path(os.environ.get("FACET_DATA_DIR")      or ROOT / "data")
WORKSPACE_DIR = Path(os.environ.get("FACET_WORKSPACE_DIR") or ROOT / "workspace")
TEMPLATES_DIR = Path(os.environ.get("FACET_TEMPLATES_DIR") or ROOT / "templates")
EXPORTS_DIR   = DATA_DIR / "exports"
DB_PATH       = DATA_DIR / "tracker.db"
LOG_DIR       = DATA_DIR / "logs"
```

The eight modules import from it instead of recomputing. **Defaults reproduce
today's behaviour exactly**, so running locally with no environment set is
byte-identical to now — that is what makes this refactor safe to do first.

### 6.2 Other hardcoded values

| Location | Now | Change |
|---|---|---|
| `frontend/src/lib/api.ts:1` | `\|\| "http://localhost:8000"` | default to `/api` (same-origin); the proxy is always present in Docker and production |
| `extension/content_script.js:12` | `const BACKEND = "http://localhost:8000"` | **deferred to Phase 3.** A config knob without the matching `optional_host_permissions` grant flow cannot actually work, and the hostname isn't known until deployment. Changing it now would half-break something that works today. |
| `extension/manifest.json:8` | `http://localhost:8000/*` | deferred with the above |
| `backend/main.py:59-65` | CORS default `localhost:3000` | keep the default; document that behind the proxy it is never consulted |
| `AUTONOMY.md:8` | `C:\Users\Pravs\Downloads\Facet2.0`, "Next.js 14" | drop the absolute path, correct the stale version |
| `CONTEXT.md`, `README.md` | `backend/.venv/python.exe` throughout | note the POSIX form alongside it |

### 6.3 No dev processes on the host

`run.py:184-188` launches `uvicorn --reload` and `npm run dev`. Both are
development servers: `next dev` uses roughly 3× the memory of `next start`
and recompiles on every request, and `--reload` will orphan an in-flight job
when it restarts.

**Change:** `run.py` becomes production by default, with `--dev` as the
opt-in for local work.

| | default (new) | `--dev` |
|---|---|---|
| backend | `uvicorn main:app` | `uvicorn main:app --reload` |
| frontend | `next build` (if stale) then `next start` | `next dev` |

On the server none of this matters anyway — the containers already run
production builds — but it removes the trap of accidentally serving `next
dev` to real users.

### 6.4 Cleanup

Delete outright:

| Path | Why |
|---|---|
| `enhance.txt`, `improvement.txt` | byte-identical duplicates of an executed brief; the outcome is in `CHANGELOG.md` |
| `__pycache__/` (repo root) | stray, gitignored |
| `$CLAUDE_JOB_DIR/`, `-p/` | empty directories created by a shell-quoting slip, not by the app |
| `.claude-flow/` | tool state containing absolute machine paths, and **not gitignored** |
| `frontend/README.md` | unmodified `create-next-app` boilerplate |
| `backend/scripts/seed_demo_data.py` | writes demo rows into `tracker.db`; harmless on a laptop, a loaded footgun on a shared server |

Regenerable build artifacts, **your call** — these cost a reinstall to get
back, so they are listed, not assumed:

| Path | Size | Cost to restore |
|---|---|---|
| `frontend/.next` | 183 MB | ~30 s rebuild |
| `frontend/node_modules` | 593 MB | `npm ci`, ~1 min |
| `backend/.venv` | 409 MB | conda + pip, several minutes |

Clearing `.next` alone is free. All three reclaim ~1.2 GB.

Keep: `start.bat` / `start.sh` (tiny, and you develop on Windows), `docs/`,
`extension/`, all `scripts/test_*.py` self-checks.

### 6.5 Code refinement, in passing

Small things worth fixing while the files are already open. None change
behaviour.

- `backend/main.py:85,97` — `@app.on_event` is deprecated; move to the
  `lifespan` context manager. Also lets the scheduler and DB shut down in a
  defined order.
- `backend/routers/tailor.py:99-100` — writing `job_description.md` before
  taking the agy lock is the overwrite race described in §2. Phase 1 removes
  it structurally.
- `backend/routers/tracker.py` — `ApplicationUpdate` accepts `resume_path` /
  `docx_path` / `cover_letter_path` from the client and `_serve_application_file`
  calls `Path(...).read_bytes()` on the result. Not cross-user exploitable in
  this architecture, but it is an unnecessary arbitrary-read primitive: store
  a filename relative to that user's `exports/`, resolve it under that root,
  and reject anything that escapes.
- `backend/routers/resume.py:84` — `_extraction_state` module global becomes
  a job row, which it needs to be anyway once extraction is queued.
- `docs/perf.md` already flags materialising `dedup_key` into an indexed
  column. Still the right upgrade, still not urgent at 1,166 rows — leave it
  documented, do not do it in this plan.

---

## 7. Phases

Each phase is independently shippable and independently verifiable. Nothing
in Phase 0–1 requires a server; both are testable on your laptop against the
real database.

### Phase 0 — hygiene (no behaviour change) ✅ **done 2026-07-28**

`paths.py` and its ten call sites · unconditional `/api` proxy · `run.py`
production default · cleanup from §6.4 · `lifespan` migration.

*Verified:* 8/8 backend self-checks pass, `tsc` clean, `npm run build`
clean, lint unchanged at 0 errors / 6 pre-existing warnings, and a
production run served 1,354 postings through the proxy with no console
errors. Database untouched.

Two things came out differently than written above:

- **Ten call sites, not eight** — `logging_setup` and `settings_store` had
  their own copies too.
- **The `/api` proxy became unconditional.** Blanking `API_BASE` alone would
  have broken local runs, because the rewrite only existed when
  `BACKEND_ORIGIN` was set — meaning local traffic used a second,
  cross-origin path that production never exercised. Behind per-user
  hostnames that difference stops being cosmetic, so local now goes through
  the same proxy.

### Phase 1 — the queue (still single-user) ✅ **shipped 2026-07-28**

Queue schema · worker as an asyncio lifespan task · portable cross-process
lock replacing the in-process `asyncio.Lock` · per-job directories ·
`POST /api/tailor` returns `202 + job_id` · frontend polling with elapsed
time and queue position · crash reconciliation.

*Verified* against a throwaway data directory with real agy: a cut through
the queue in 55.7s; three simultaneous submissions accepted with positions
rather than a 409; queued-cancel works and running-cancel correctly refuses;
scratch directories cleaned after every run; a hard kill mid-cut recovered on
restart as a failed job with a real message.

Differences from the plan as written:

- **The queue lives in `data/queue.db`, not `control.db`.** There is no
  control plane yet. `FACET_QUEUE_DB` points it at a shared file, so Phase 2
  moves the worker out by configuration rather than by code.
- **The lock is not `flock`** — it is a small portable wrapper, because the
  dev machine is Windows and the target is Linux. Windows byte-range locks
  are also *mandatory*, not advisory, which is why the holder diagnostic
  lives in a sidecar file rather than in the locked file itself.
- **The `resume_path` fix moved to Phase 4.** It is a hardening change with
  no user-visible effect in a single-user deployment, and bundling it with
  the queue would have made a risky change riskier. It must land before
  Phase 3 exposes anything publicly.
- **Cancelling a *running* job is deliberately refused** (409) rather than
  faked. Killing the agy subprocess needs process-tree teardown; that is
  Phase 4, together with the same machinery for the admin dashboard's Cancel.

*Still to do before calling Phase 1 closed:* use it for a week of real cuts.

**Known edge:** a hard kill can leave the agy grandchild alive long enough to
recreate its scratch directory after the startup sweep, leaving one empty
directory that the next boot removes. Same root cause as running-cancel, same
fix, Phase 4.

### Phase 2 — control plane and admin portal ✅ **shipped 2026-07-28**

`backend/control/` · users CRUD · provisioning steps 1–6 · admin UI (users,
storage, queue, audit) · audit log · soft delete with a 30-day grace period ·
export bundles.

*Verified:* created a user, booted the app against nothing but the
provisioned directories, and it served and began ingesting its own postings
(449) fully isolated from the existing instance (1,361). Delete →
auto-export → data moved aside → restore, all through the API and the UI.

Differences from the plan as written:

- **The admin UI is one self-contained HTML page**, not a second Next app.
  No build step, no second `node_modules`, no second deploy — an admin panel
  used by one person doesn't justify a React application, and the API
  underneath is the real product if it ever does.
- **`HOST_ROOT` defaults to `<repo>/.facet-host`**, not `/srv/facet`, so a
  local checkout is self-contained. The host sets `FACET_HOST_ROOT`.
- **Deleting a running instance is refused.** Discovered while testing:
  moving data out from under a live process doesn't stop it — SQLite and the
  logger recreate their files, and the "deleted" account reappears with a
  fresh empty database. Phase 3's `compose down` makes this a stop-then-delete
  sequence; until then it fails clean.
- **Your own migration is not done.** `POST /api/users/import` copies (never
  moves) an existing installation into a new instance. Running it against
  real data is your call.

*Still open before Phase 3:* decide whether to migrate your own installation,
and whether `data/settings.json` stays per-user (§11 question 4).

### Phase 3 — host runtime and Cloudflare ✅ **code shipped 2026-07-28**

Provisioning steps 6–10 · systemd unit template · per-user frontend compose
project · generated `cloudflared` ingress · Access applications with manual
mode · `deploy/README.md`.

**The architecture changed here, and D6 is the reason.** The plan assumed
both halves in containers with a host agy worker draining a shared queue.
Building it made the cost visible: containers can't reach `~/.gemini`, so
that shape needs a second queue layer, a remote mode in `run_agy`, and job
directories mounted into both sides — a great deal of machinery to isolate
instances of the same trusted application from each other.

Instead: **the backend runs natively, the frontend stays containerised.** agy
then works with no new machinery at all, because the cross-process lock built
in Phase 1 already serializes N processes against one CLI. Docker keeps the
job it is actually good at — pinning a reproducible node build.

**A second consequence, and a better one than planned.** cloudflared matches
on hostname *and path*, so `/api/*` routes straight to the native backend and
everything else to the frontend. Next bakes rewrite destinations at build
time, so a Next-side proxy would have forced one image build per user. Tunnel
routing means no per-user address is baked in anywhere and **one image serves
everybody**.

*Verified here:* all ten provisioning steps run; generated ingress is
correct, parses as YAML, orders `/api` before the catch-all, targets only
loopback, and drops a deleted user's hostname while leaving others intact;
Access payloads allow exactly one address; a missing tool reports `manual`
with the exact command instead of failing.

*Not verified here — no Docker daemon, no systemd, no tunnel on the dev
machine:* live `compose up`, `systemctl`, tunnel reload, and the Cloudflare
API calls. Command construction and generated config are covered by
self-checks; execution needs the VM.

**Phase 2's delete-a-running-instance limitation is resolved.** Deletion now
stops the service and container first, then verifies the port is closed
before moving anything.

*Done when:* a second real person logs in at their own hostname and cuts a
facet that queues behind yours.

### Phase 4 — hardening and retention ✅ **shipped 2026-07-28**

The `resume_path` hardening · process-tree teardown · cancel a running job ·
retention sweeper · quotas · dashboard metrics and failure buckets.

**The arbitrary-read primitive is closed at two layers.** The three path
columns are gone from `ApplicationUpdate`, so a client cannot set them; and
`resolve_export` re-resolves whatever the database holds against
`EXPORTS_DIR` and refuses anything outside it. Either layer alone would do;
both means a bad row from any source still cannot escape. The pipeline now
stores bare filenames, which also stops a row pinning itself to one
machine's directory layout — exactly what provisioning and import move.

**Process-tree teardown resolved three open items at once.** agy runs under
`Popen` in its own process group (POSIX) or killed with `taskkill /T`
(Windows), so cancelling stops agy *and its children*. That is what made
cancel-a-running-job real, what stops the subprocess outliving a shutdown,
and what closes the orphaned-scratch-directory case from Phase 1.

**Retention only deletes what is provably unreferenced.** An export attached
to an `applications` row is part of the record and is never touched, at any
age. It fails closed: a missing or unreadable database keeps everything.
Quotas warn and never delete — deleting under disk pressure is how you lose
the file you meant to keep.

*Verified with real agy:* a running job cancelled mid-flight left zero agy
processes, a `cancelled` row (not `failed`), and no scratch directory; the
next job ran normally, proving the lock released. The old attack — PATCH a
path, then GET the file — is ignored at the model, and a hostile value forced
straight into the database returns 404.

### Phase 5 — operational ✅ **shipped 2026-07-29**

`control/backup.py` (backup, verify, restore, prune) · daily backup + prune +
verify in the control plane · `deploy/facet-control.service` ·
`docs/runbook.md` · backup freshness on the dashboard.

**The restore drill is a self-check, not a paragraph.**
`python -m control.backup` creates an account, fills it, backs it up,
*destroys* it, restores it, and verifies the rows came back. An untested
backup is not a backup — so if that stops passing, you find out on a laptop
rather than on the day you need it.

Every database copy is `VACUUM INTO`, never `cp`: WAL keeps recent writes in
a sidecar that a plain copy loses. `workspace/` is backed up too — the Stone
is not in any database, and a backup without it restores an account that has
lost the thing every resume is cut from.

Guards that fall out of taking restores seriously: a restore refuses while
the instance is serving (same failure mode as deleting under a live process);
forcing one *moves* the existing directory aside rather than deleting it, so
restoring the wrong bundle is itself undoable; and pruning always keeps the
newest bundle per user regardless of age, because a rule that can leave an
account with no backup is worse than keeping too much.

Backups are verified after every run — integrity check plus row counts
against the manifest. The dashboard shows age per user, amber past a day, red
if never.

---

## 8. Safety — how the existing data survives

Your live `data/tracker.db` holds 1,166 postings and a real application
history. It is the thing this plan must not break.

1. **No schema change.** Every new table lives in `control.db`. `tracker.db`
   keeps its current schema, its `_POSTING_COLUMNS` additive migration path,
   and every query that reads it.
2. **The migration is a file copy.** Your database becomes user #1's
   database by being copied to `/srv/facet/users/<you>/data/`. Nothing is
   transformed.
3. **Copy with `VACUUM INTO`, never `cp`.** WAL mode means recent writes live
   in `tracker.db-wal` and a plain copy silently misses them. This is not
   theoretical — a `cp` of this database earlier showed 906 rows against a
   live 1,166.
4. **The original stays put** until the new location has been verified
   serving live traffic.
5. **Phase 0 changes no behaviour**, so if something breaks there, it is a
   path bug with an obvious cause, not a data problem.
6. **Backups before Phase 2**, with a restore actually performed once.

Product boundaries from `CONTEXT.md` §8 are unaffected: nothing scrapes,
nothing auto-submits, `profile.json` stays the sole source of truth per user,
truthfulness-mode semantics are untouched, and no telemetry is added.
`data/settings.json` (API keys) stays per-user and per-instance, never echoed
back, exactly as now.

---

## 9. Risks

| Risk | Severity | Handling |
|---|---|---|
| **Ten people's tailoring runs through one signed-in agy account** | **Blocking, non-engineering** | Check Antigravity's terms before inviting anyone. No amount of code fixes this, and it is the only item that can invalidate the plan. |
| agy quota exhausted mid-day | High | Surface remaining quota on the admin dashboard if the CLI exposes it; otherwise bucket the failure reason so it is diagnosable rather than mysterious |
| Docker group ≈ root for the control plane | Medium | Single-admin box, Access-gated, audit-logged; desired-state-file upgrade path documented in §1 |
| Cloudflare 100 s timeout | Medium | Designed around from the start (§2) |
| Port reuse after deletion | Medium | Ids never recycled (§4.2) |
| Oracle reclaims an idle Always Free instance | Medium | Ten users plus a 6-hour scheduler stays above the threshold; know the policy exists |
| arm64 images | Medium | Ampere A1 is arm64. `node:24-alpine` is fine. **Do not put WeasyPrint on Alpine** — musl plus Pango/Cairo is the fight already lost once on Windows. Use `python:3.12-slim` with `libpango-1.0-0`, `libpangoft2-1.0-0`. |
| Ten `next dev` processes | Medium | §6.3 — production builds only |
| Memory | Low | ~10 × (150 MB web + 150 MB api) + control ≈ 3.5 GB of 12 GB |
| Tunnel misroutes a hostname to the wrong port | Low but severe | Optional defence in depth: each container binds `127.0.0.1` only, and the api verifies the Access JWT email matches `FACET_EXPECTED_USER_EMAIL`. Cheap; worth it. |

---

## 10. Explicitly not doing

- Real multi-tenancy — `user_id` columns, ownership checks, the
  `seen_postings` split, per-user scoring fan-out. Not needed in this
  architecture; §0 explains why, and §0 explains how to get there later if
  the premise changes.
- Postgres. SQLite with WAL, one database per user, is not remotely the
  bottleneck — one agy binary is.
- Open signup, password auth, email verification, password reset. Cloudflare
  Access provides identity; adding a second identity system would be
  strictly worse.
- A test framework. New logic carries one runnable `demo()`/`assert` check in
  the existing style, per `CONTEXT.md` §10.
- Changing business logic, API contract meaning, the data model, the
  gemcutting vocabulary, or user-facing copy.
- Materialising `dedup_key` — documented in `docs/perf.md`, still not urgent.

---

## 11. Decisions made

Settled. Recorded so they don't get re-litigated, with the reason, because a
decision without its reason gets reversed by the next person who finds it
inconvenient.

| # | Decision | Why |
|---|---|---|
| D1 | **Per-user instances, not shared-process multi-tenancy** | §0. Deletes the schema split, the IDOR audit, and per-user scoring. Not a dead end — merging N databases later is a script. |
| D2 | **`data/settings.json` (Adzuna/Jooble keys) stays per-user** | Confirmed 2026-07-28. Each person brings their own keys: no shared quota, no operator liability for someone else's usage, and it matches the current code with no settings-precedence change. |
| D3 | **Subdomain per user** (`alice.facet.example`), not path routing | One Access policy per hostname is far cleaner than path-scoped rules, and Next's basePath would otherwise need reworking. Costs a wildcard DNS record. |
| D4 | **The queue is polled, not streamed** | Survives reload, needs no open connection, gives queue position free. SSE would clear the proxy header timeout but dies on reconnect and still needs the queue underneath. |
| D5 | **Admin UI is one static HTML page**, not a second Next app | No build step, no second `node_modules`, no second deploy for a panel one person uses. The API underneath is the real product. |
| D6 | **agy stays on the host; containers never call it** | Its credentials live in `~/.gemini`, a per-OS-user thing a container can't reach. Fighting this buys nothing. |
| D9 | **Backend native, frontend containerised** (confirmed 2026-07-28, revises the original all-container plan) | Follows from D6. Containerising the backend needs a second queue layer, a remote `run_agy`, and shared job-directory mounts — a lot of machinery to isolate instances of the same trusted app. Native, the Phase 1 flock already serializes N processes against one CLI. Docker keeps the frontend, where a reproducible node build is real value. |
| D10 | **cloudflared routes `/api/*` by path**, rather than Next proxying it | Next bakes rewrite destinations at build time, so a Next-side proxy means one image build per user (each backend has a different port). Tunnel path-matching means no per-user address is baked in anywhere and one image serves everybody. |
| D7 | **Retention defaults**: 30 days unreferenced exports, 30-day delete grace, 2 GB soft quota | All three are settings. Referenced exports are never auto-deleted; nothing is ever auto-deleted under disk pressure. |
| D8 | **Cloudflare manual mode first, API automation second** | An API token with Access-write privileges is a real capability. Manual is ~2 minutes per user and there are ten. Automation is opt-in. |

---

## 12. Open items — the completion checklist

Everything deferred, discovered, or still unanswered, in one place. Nothing
here is lost; each line says where it lands.

### Blocking — not an engineering question

- [ ] **agy account terms for ten users.** Ten people's tailoring runs
  through one signed-in account. This is the only item that can invalidate
  the whole plan, and no amount of code fixes it. Answer before Phase 3 goes
  public.

### Deferred to Phase 4, with the reason

- [x] ~~**`resume_path` hardening.**~~ Closed in Phase 4 at two layers: the columns are gone from `ApplicationUpdate`, and `resolve_export` re-resolves against `EXPORTS_DIR`.
- [x] ~~**Cancel a running job.**~~ Shipped in Phase 4 — the agy process tree is killed first, and the row is only marked once that succeeded.
- [x] ~~**Process-tree teardown on shutdown.**~~ Shipped in Phase 4.
- [x] ~~**agy grandchild orphan directory.**~~ Closed by the same teardown work.
- [x] ~~**Retention sweeper**~~ Shipped in Phase 4, fail-closed.
- [x] ~~**Dashboard display of failure buckets.**~~ Shipped in Phase 4.

### Deferred to Phase 3

- [ ] **Extension's hardcoded `http://localhost:8000`.** Started, then
  deferred; the tree is back at its committed state. The design is worked out
  — pick it up from here rather than re-deriving it:

  **It is not only a hardcoded URL. There is a latent bug.** Since Chrome 85
  a content script's fetches follow the *page's* CORS rules, so
  `content_script.js` fetching the backend from greenhouse.io is a
  cross-origin request the server would have to allow — and Facet's allowlist
  is its own frontend, correctly. So the resume-attach path is likely already
  broken today, independently of any of this.

  The fix that solves both: **move every server call into the service
  worker**, which holds host permission and is not subject to page CORS. It
  also gets `credentials: "include"`, so a Cloudflare Access session cookie
  rides along — which a content script on a job board could never do.

  Shape:
  - `manifest.json`: drop `http://localhost:8000/*` from `host_permissions`,
    add `optional_host_permissions` (`http://*/*`, `https://*/*` — Chrome
    prompts for the one specific origin at grant time) and `options_ui`.
  - `options.html` / `options.js`: enter the Facet URL, request permission
    for that origin, test the connection, save to `chrome.storage.sync`.
  - `background.js`: handle `facet:profile`, `facet:resume`, `facet:config`.
    Return errors rather than throwing — a rejected promise reaches the
    content script as an opaque "message port closed". Detect the Access
    login redirect (HTML instead of JSON) and report `not_signed_in`.
    A Blob cannot cross the messaging boundary: send the resume as a data URL
    and rebuild the `File` on the other side.
  - `content_script.js`: replace both `fetch` calls with
    `chrome.runtime.sendMessage`, and surface the new error cases in the
    existing banner.

  Unchanged: no `submit_selector`, no `.click()` on a final control. That
  boundary is not part of this work.
- [x] ~~**Delete-a-running-instance.**~~ Resolved in Phase 3: deletion stops
  the service and container, then verifies the port is closed before moving
  anything.

### Deferred to Phase 5

- [x] ~~**Backups**~~ Shipped in Phase 5: `control/backup.py`, daily, `VACUUM INTO`, pruned, verified after every run.
- [x] ~~**A restore drill.**~~ Shipped in Phase 5 as a self-check — `python -m control.backup` destroys and restores an account for real.
- [x] ~~**Runbook**~~ Shipped in Phase 5: `docs/runbook.md`.

### Needs verification on the target machine, not here

- [ ] **The POSIX `fcntl` lock path.** `filelock.py` is exercised on Windows
  by its self-check; the Linux branch has not been run.
- [ ] **`docker compose` provisioning and `cloudflared` ingress.** No Docker
  daemon on the development machine, so Phase 3 verifies command construction
  and generated config, not live execution.
- [ ] **arm64 image builds.** Oracle's Ampere A1 is arm64.
  `python:3.11-slim` and `node:24-alpine` both have arm64 variants and the
  backend already uses Debian (Alpine + WeasyPrint is the fight to avoid).
- [ ] **Oracle idle-instance reclamation.** Know the policy before relying on
  the box.

### Still to decide

- [ ] **Migrate your own installation?** `POST /api/users/import` copies and
  never moves. Your call, and safest done once Phase 3 can serve the copy
  side by side with the original.
- [ ] **Turn on Cloudflare API automation, or stay manual?** (D8 defers, does
  not answer.)

### Health of the existing app, unrelated to this plan

- [ ] **Python 3.10 reaches EOL in October 2026.**
- [ ] **`react-hooks/set-state-in-effect`** — 6 warnings, deliberately not
  errors. Worth its own pass with the React Compiler.
- [ ] **Materialise `dedup_key`** into an indexed column — documented in
  `docs/perf.md`, still not urgent at ~1,400 rows.
