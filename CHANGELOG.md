# Changelog

Newest first. One entry per autonomous pass (see `AUTONOMY.md`).

## 2026-07-29 — Administrators, profiles, and a queue you can see

Three additions and two leaks closed.

**An admin flag, enforced at the endpoint.** `is_admin` on the user row,
granted at startup from `FACET_ADMIN_EMAIL` — never revoked from there, so a
typo in an env var cannot leave a deployment with no administrator. The
in-app admin page adds users, issues sign-in links, suspends and signs people
out; deleting an account and restoring a backup stay in the control plane on
:9000, because a button that destroys a career record should take more than
one click from a tab left open.

The Admin link is hidden from everyone else, and that is presentation, not
protection. `scripts/test_admin.py` signs in as an ordinary user and calls all
eight admin routes directly: every one answers 404. It also checks that
promotion and demotion apply to a session already in progress, and that an
administrator cannot suspend or demote themselves — the failure with no
recovery short of editing control.db by hand.

**A profile page**, reached from a standard account menu. Who you are on this
deployment, whether your Stone is imported, what is in your Cabinet, the disk
it occupies, where you are signed in, and a password change that requires the
old password.

**The agy queue on the status page.** One authenticated CLI serves the whole
host, so a colleague's run genuinely delays yours — and without saying so the
app merely feels slow. It shows your position counted across everybody, and
"someone else is using the AI" when that is the truth. Counts and positions
only: never another person's payload.

Two leaks found while building it, both pre-existing:

- **`/api/queue` returned every user's jobs**, payloads included — which for
  a tailor job is the company and the full job description. Now scoped to the
  caller.
- **`/api/queue/{job_id}` had no ownership check.** Job ids are sequential
  across everybody, so counting upwards read, and cancelled, anyone's work.

And one bug the admin test caught immediately: provisioning now runs inside
an authenticated request, so `paths.RULES_PATH` followed the *administrator's*
workspace. Every new account would have been seeded from whichever admin
clicked the button. It reads the host template explicitly now.

A route-ordering trap on the way: `/api/queue/agy` registered after
`/api/queue/{job_id}` answers 422, because FastAPI takes the first match and
tries to parse "agy" as an integer. The same first-match-wins rule as the
tunnel's ingress list, two layers apart.

## 2026-07-29 — Facet's own login

Cloudflare Access is no longer what authenticates anybody. Facet has a login
page, a password per person, and an admin portal that issues sign-in links.

That is a real change in what this codebase is responsible for. It did not
hold credentials before; a bug in the wrong place here does not lose a
feature, it hands somebody's job search to whoever is trying. So every choice
was the boring one.

**scrypt from `hashlib`**, not a new dependency. Memory-hard at 32 MB per
attempt, and argon2-cffi is marginally better but not worth a compiled
package on an ARM VM. Parameters are stored *with* each hash, so raising them
later does not lock anyone out — an old hash verifies with its own parameters
and is upgraded on the next successful login, the one moment the plaintext
exists.

**Sessions are server-side.** A signed self-contained token cannot be
recalled, and revocation had to be immediate: suspending someone, deleting
them, or changing a password all end sessions *now*. The cookie holds a
random token; the database holds its SHA-256, so a leaked backup is not a set
of working keys.

The properties `scripts/test_auth.py` asserts against the real app, each one
invisible when the happy path works:

- a wrong password and an unknown address return byte-identical responses,
  and take the same time — `verify_password` burns a full scrypt on a missing
  account rather than returning early
- eight failures lock that account, the correct password included; a lockout
  that lets the right password through stops nobody
- lockout does not leak across accounts, or one attacker locks out everyone
- an invited account cannot be signed into with a blank password
- an invite link works once and expires; setting the password clears it in
  the same statement
- changing a password requires the old one, and ends every other session
- a suspended user's live cookie stops working immediately

One bug the tests found: `AuthError` had no exception handler, so a password
below the length floor reached the catch-all and came back as a 500
"Something went wrong" — which tells someone typing a password nothing.

The 401 redirect lives in `api.ts`'s single `request()` rather than at each
call site, guarded against firing twice: a dashboard makes several requests
at once, and five simultaneous 401s would queue five navigations with `next`
pointing at `/login` itself.

`scripts/dev_access.py`, added an hour earlier to fake the Access header
locally, is deleted. A real login page is a better answer to the same problem.

Access can still be layered in front if you want unauthenticated traffic
stopped at the edge. It is documented as optional now, not required.

## 2026-07-29 — One instance, many users

Facet now serves everyone from a single backend and a single frontend at one
hostname, instead of a process pair and a subdomain per person.

The prompt was a domain: `facet.nivil.dpdns.org`. That turned out to rule out
the existing design on its own — Cloudflare's free Universal SSL covers one
level of subdomain, so `alice.facet.nivil.dpdns.org` is two levels deep and
has no certificate. Per-user subdomains would have failed at HTTPS for every
user, with a paid certificate as the only fix.

**Data is separated by file, not by query.** Each user gets their own
`tracker.db` under `users/<slug>/`, so isolation is a property of the
filesystem. The alternative — shared tables with a `user_id` column — makes
every missing `WHERE` clause a leak of someone's job applications, and there
are no missing-clause bugs available in a design where the rows are in
different files. It also meant the existing schema was untouched, so a
`tracker.db` from the single-user build opens unchanged.

`services/paths.py` is the mechanism: the path constants became functions of
a `ContextVar` holding the current user, resolved through PEP 562
`__getattr__` at access time. Every consumer moved from
`from services.paths import DB_PATH` to `paths.DB_PATH`, because a `from`
import copies the value once at startup — which is the whole failure this
change exists to avoid.

Three bugs found while building it, all silent:

- **`run_in_executor` drops ContextVars.** `db.fetch_all` dispatches queries
  to a worker thread, and that dispatch does not carry the context. Every
  query would have resolved with no user set and read the shared database —
  returning plausible, wrong data with nothing raised anywhere.
  `asyncio.to_thread` copies the context; the fix is one word.
- **`routers/tailor.py` imported `PROFILE_PATH` from `routers.resume`**, a
  re-export chain that bound the path at import just as a direct import
  would.
- **A whitespace-only identity header** passed the emptiness check, was
  stripped to `""`, and reached the registry as an empty email lookup. Found
  by the isolation check, not by reading.

`scripts/test_multiuser.py` writes as Alice, reads as Bob, and asserts
absence, through the real database, workspace and queue paths. It was
verified to fail: reinstating `run_in_executor` produces
`AssertionError: bob can see alice's applications`.

Identity comes from Cloudflare Access's
`Cf-Access-Authenticated-User-Email`, which is trustworthy only because the
origin binds loopback — so the backend now refuses to start multi-user on a
non-loopback address rather than warning about it. `identity.resolve` has no
return value meaning "carry on as nobody"; the missing-header path raises,
because a fallback there resolves to the shared directory.

`scripts/migrate_to_multiuser.py` moves an existing single-user installation
into its owner's directory. It copies rather than moves, compares row counts,
runs an integrity check, and leaves the originals in place — the thing being
moved is the only record of where somebody applied for work.

Verified on the host: 401 with no identity, 403 for an unregistered address,
the owner's own migrated record for his, and `[]` for a second user added
**while the server was running** — no restart needed.

Then the redundant half came out. Provisioning had ten steps; it has six.
Gone: the per-user port, env file, systemd unit and compose project, along
with `runtime.compose_*` and `runtime.service_*` — about 100 lines of dead
command construction. Net **-55 lines** across the cleanup.

Removing them exposed two things that had quietly become dangerous:

- **Suspending a user stopped their instance.** With one shared process that
  would have suspended all ten. It is a status change now, and the app only
  serves `active`.
- **Deleting or restoring a user demanded stopping their backend**, which is
  everyone's backend. Replaced by `provision.quiesce`: the status gate stops
  new requests, and the user's SQLite handle is closed before their directory
  moves. That last part matters — an open handle follows the inode, so
  without it a deleted account keeps being written to inside the grave while
  the next request opens a fresh empty database. It is the Phase 2 failure
  wearing new clothes.

`web_port` and `api_port` stay as columns, written as 0. Dropping a column in
SQLite means rebuilding the table, and the rule for user-owned data is
additive migrations only — an unused column costs nothing, a table rebuild on
somebody's live record is how records get lost.

## 2026-07-29 — The extension, and the bug it was hiding

`extension/` rebuilt around one change: every call to the Facet server now
happens in the service worker instead of the content script.

That was filed as "the hardcoded `http://localhost:8000` needs to go", and it
did — but the address was the smaller half. Since Chrome 85 a content
script's `fetch` follows the **page's** CORS rules rather than the
extension's. A content script on greenhouse.io calling your Facet server is
therefore a cross-origin request the server has to permit, and Facet's
allowlist is its own frontend, correctly. So the resume-attach path could not
have worked against a correctly-configured server, and had been quietly
broken rather than merely unportable.

The fix is not to widen the allowlist. It is to make the call somewhere page
CORS does not apply. A service worker holding host permission is that place,
and it brings the thing that makes a hosted deployment possible at all:
`credentials: "include"` sends the Cloudflare Access session cookie, so a
signed-in browser reaches its own instance. A content script on a job board
could never send that cookie.

The address is now an optional host permission granted from a new options
page, requested per install. The old manifest demanded `localhost:8000` at
install time — an alarming permission for everyone, and the wrong address for
every hosted user. Disconnecting hands the permission back rather than
keeping host access to a server the extension has been told to forget.

Three details that are only obvious once they have gone wrong:

- **A Blob cannot cross the messaging boundary.** Structured clone turns it
  into an empty object, and the failure surfaces as a File with no contents
  attached to a form, far from the cause. Resume bytes travel as a data URL.
- **`btoa(String.fromCharCode(...bytes))` throws RangeError** on anything
  past a few hundred KB, so it passes on every small fixture and fails on
  real resumes. Encoding walks the buffer in chunks, and the check exercises
  300 KB plus the bytes either side of the chunk boundary.
- **Cloudflare Access answers a signed-out request with 200 and a login
  page.** Trusting the status gives `Unexpected token '<'`, which reads like
  a bug in Facet rather than "you are signed out". Detection is by content
  type and final origin.

Errors are returned as values, never thrown: an unhandled rejection inside
`onMessage` reaches the caller as "message port closed", which tells nobody
anything. Every failure ends in a banner naming the problem, and offering
"Open settings" when that is the fix.

`node extension/check.mjs` covers manifest structure and file references,
permission shape, selector schema, address normalization and the byte
transport. It caught one real bug while being written: `file:///etc/passwd`
was being coerced into the origin `https://file`, because a missing scheme
was filled in unconditionally rather than only when genuinely absent.

The no-submit gate is now asserted rather than commented — on the code and on
the selector data, so the schema has nowhere to put a submit selector. It was
verified to fail when a submit path is introduced, because a test that cannot
fail is not a test. The byte transport was checked end to end against a real
18 KB PDF from the running backend: identical in, identical out.

## 2026-07-29 — Phase 6: on the host at last, and six bugs it found

Moved to the Oracle Ampere A1 the whole plan was written for — aarch64,
Ubuntu 24.04, Python 3.12, Node 22.23, Docker 29.1 — and ran everything that
had only ever been reasoned about. Six real bugs, all of the kind that a
development machine structurally cannot show you.

**The agy lock was never shared.** `FACET_AGY_LOCK` was set nowhere, so each
instance fell back to `$FACET_DATA_DIR/agy.lock` — a lock inside its own
private directory. Ten users would have made ten locks and run ten concurrent
agy processes against one authenticated CLI: precisely the failure the queue,
the file lock and the native-backend split all exist to prevent. Nothing in a
single-instance test can see this; the architecture only fails when two real
users overlap. Now written into every generated `.env`, and
`control.provision`'s self-check asserts the lock is outside the user's data
directory and stays that way.

Then the proof, which is the point of coming here: two instances, separate
data, one lock, both submitting a tailoring run at the same instant. 25.4 s
and 49.8 s, the second beginning as the first ended. Serialization across
processes, on the real host, against the real CLI.

**Provisioning could not use systemd at all.** The control plane does not run
as root, so `systemctl enable` returned *Interactive authentication
required*. This was invisible on Windows for an unpleasant reason: systemd
was absent, every step took its manual branch, and the self-check asserted
that manual steps count as success. The test passed because the feature was
unreachable. Now the units are systemd **user** units — no root, no polkit,
and they run as the account that owns agy's credentials, which makes the
"authenticated in my shell, unauthenticated in the service" mismatch
impossible by construction rather than by documentation. `deploy/install.sh`
renders them from the real checkout path; `deploy/user/` holds the templates.

The self-checks that depended on systemd being absent now say so out loud and
pin capabilities to false, because a test that reconfigures the host it runs
on is not a test.

**agy was invisible to systemd.** Units inherit a minimal PATH without
`~/.local/bin`. Services started, reported healthy, served every page, and
had no agy — a failure that surfaces at the first tailoring attempt rather
than at startup. Fixed in the unit; `deploy/install.sh` now checks agy
against the units' PATH rather than your shell's, since those are different
questions and only one of them matters.

**`verify()` raised instead of reporting.** A database too corrupt for SQLite
to open threw `DatabaseError` straight out of the one function whose entire
job is detecting corruption. The Windows run had been slow enough that a
byte-flip landed in the gzip layer first. The same slowness hid a second bug:
two backups of one user in the same second collided on one filename and the
second silently replaced the first — a backup destroying a backup. Both
fixed, both asserted rather than left to timing.

**`/status`'s agy check was dead code**, still calling `_agy_lock` from
before the queue landed. Replaced with `FileLock.is_held()`, which answers
across instances instead of within one process — the only useful form of the
question once there is more than one instance.

**`run.py` leaked processes and bound publicly.** `npm` is a launcher, so
terminating it left `next` holding port 3000 and the next `./start.sh` died
on a port owned by nobody visible. And `next start` binds 0.0.0.0 by default:
on a VM with a public IP, the friendliest command in the repo published the
whole app with no authentication in front of it. Now loopback by default
(`FACET_BIND` to override, deliberately) with process-group teardown on both
services. Telemetry is disabled through the environment rather than a
per-machine config file, so "no telemetry" travels with the repo.

Also verified live: the arm64 image (2m50s, 308 MB), per-user compose
containers bound to loopback, generated tunnel ingress with `^/api/` ahead of
the catch-all, and the full lifecycle — create, delete (which refuses without
a matching email), undelete, resume — with data intact and other users
untouched. A real agy pass produced a tailored PDF, DOCX and cover letter
faithful to the source resume.

The application is now called **Facet**. Docs and self-check commands use the
POSIX interpreter path.

## 2026-07-29 — Phase 5: backups, and the drill that proves them

`control/backup.py` — backup, verify, restore, prune — plus a daily loop in
the control plane, `deploy/facet-control.service`, `docs/runbook.md`, and
backup freshness on the dashboard.

**The restore drill is a self-check, not a paragraph in a runbook.**
`python -m control.backup` creates an account, fills it with applications,
postings, exports and a Stone, backs it up, **destroys the instance**,
restores it, and verifies the rows came back. An untested backup is not a
backup — so if that stops passing you find out on a laptop, not on the day
you need it. Written in Python rather than shell precisely so it could be
run here.

Every database copy is `VACUUM INTO`, never `cp`: WAL keeps recent writes in
a sidecar that a plain copy loses — measured once on this project as 906 rows
against a live 1,166. `workspace/` is backed up too; the Stone is not in any
database, and a backup without it restores an account that has lost the thing
every resume is cut from.

Guards that fall out of taking restores seriously:

- A restore **refuses while the instance is serving** — the same failure mode
  as deleting under a live process, and it ends the same way.
- Forcing one **moves the existing directory aside** rather than deleting it,
  so restoring the wrong bundle is itself undoable.
- Pruning **always keeps the newest bundle per user** regardless of age. A
  rule that can leave an account with no backup at all is worse than keeping
  too much.
- Bundles are **verified after every run** — SQLite integrity check plus row
  counts against the manifest. A corrupt or tampered bundle fails
  verification rather than being discovered during a restore.

The dashboard shows backup age per user: amber past a day, red if never.
A backup system nobody looks at is one that stopped working three weeks ago.

`docs/runbook.md` covers the failure modes by symptom, including a section on
things that look wrong but are working as designed — a queue with people
waiting, steps reported `manual`, delete refusing while an instance serves.

## 2026-07-28 — Phase 4: hardening and retention

**The arbitrary-read primitive is closed, at two layers.** `resume_path`,
`docx_path` and `cover_letter_path` are gone from `ApplicationUpdate`, so a
client cannot set them; and `resolve_export` re-resolves whatever the
database holds against `EXPORTS_DIR` and refuses anything outside it. Either
layer alone would do. Both means a bad value arriving from *any* source —
including a row written before this change — still cannot escape.

The pipeline now stores bare filenames rather than absolute paths. Besides
being the safer input, it stops a row pinning itself to one machine's
directory layout, which is exactly what provisioning and account import move.
Rows holding old absolute paths still resolve.

**Process-tree teardown closed three open items at once.** agy runs under
`Popen`, in its own process group on POSIX and killed with `taskkill /T` on
Windows, so stopping a run kills agy *and everything it spawned*. That made
cancel-a-running-job real, stopped the subprocess outliving a shutdown, and
closed the orphaned-scratch-directory case left over from Phase 1 — all the
same root cause.

Cancelling now works on a running job: the process tree is stopped first and
the row is marked only if that succeeded. Reporting a job cancelled while the
process keeps burning the CLI would be a lie the rest of the system has to
live with. A late failure from the killed process can no longer overwrite the
cancellation, so a deliberate stop reads as `cancelled`, never `failed`.

**Retention only removes what is provably unreferenced.** An export attached
to an `applications` row is part of the record and is never touched, whatever
its age; an export from an abandoned cut is scratch. Runs daily, dry-run
capable, and `GET /api/retention` previews it. Quotas warn and never delete —
deleting under disk pressure is how you lose the file you meant to keep.

A bug the self-check caught while writing it: a *missing* `tracker.db` made
`referenced_exports` return an empty set, which reads as "nothing is
referenced" and would have swept every export the user had. It now fails
closed — an absent or unreadable database keeps everything.

**Dashboard** gains queue metrics (wait/run p50 and p95) and failure reasons
bucketed by cause, plus a retention panel. "3 failures" is noise; "3 failures,
all `no_output_file`" points straight at `--add-dir`.

Verified with real agy against a throwaway data directory: a running job
cancelled mid-flight left zero agy processes, a `cancelled` row, and no
scratch directory; the next job ran normally, proving the lock released
cleanly. The old attack — PATCH a path then GET the file — is ignored at the
model, and a hostile value forced directly into the database returns 404.

## 2026-07-28 — Phase 3: host runtime and Cloudflare

Provisioning now goes all the way to a routed, access-controlled instance:
ten steps, ending at a health check.

**The architecture changed, and building it is what revealed why.** The plan
had both halves in containers with a host worker draining a shared agy queue.
Containers can't reach `~/.gemini`, so that shape needs a second queue layer,
a remote mode in `run_agy`, and job directories mounted into both sides — a
great deal of machinery to isolate instances of the same trusted application
from each other.

Instead the **backend runs natively and the frontend stays containerised**.
agy then works with no new machinery at all: the cross-process lock built in
Phase 1 already serializes N processes against one CLI. Docker keeps the job
it is good at — pinning a reproducible node build.

**One image serves every user.** cloudflared matches on hostname *and path*,
so `/api/*` goes straight to the native backend and everything else to the
frontend container. Next bakes rewrite destinations at build time, so a
Next-side proxy would have forced a separate image build per user, each
backend being on a different port. Letting the tunnel route means no per-user
address is baked in anywhere.

**Nothing is published on any interface.** Every ingress target is loopback;
the tunnel is the only way in and Cloudflare Access is the authentication.
That is why Facet still has no login of its own.

**A missing tool is not an error.** No systemd, no Docker daemon, no
Cloudflare token — the step reports `manual` and hands back the exact command
to run by hand, shown in the portal. A half-configured host says what it
needs instead of failing at step 7 with a traceback. Capabilities are on the
portal header so manual mode is explained rather than mysterious.

**Ingress is regenerated from the user table, never patched.** An incremental
scheme drifts the moment one edit half-fails, and drift here means a hostname
pointing at the wrong port — one person's Facet served to another. Deleting a
user drops their hostname immediately, for the same reason ids are never
recycled.

**Phase 2's delete-a-running-instance refusal is resolved.** Deletion stops
the service and container first, then verifies the port is closed before
moving anything.

New: `deploy/facet-api@.service`, `docker-compose.user.yml`,
`control/runtime.py`, `control/cloudflare.py`, `deploy/README.md`.

Verified here: all ten steps run; generated ingress is correct, parses as
YAML, orders `/api` before the catch-all, targets only loopback, and drops a
deleted user's hostname while leaving others intact; Access payloads allow
exactly one address, never a domain.

Not verified here — no Docker daemon, systemd or tunnel on this machine:
live `compose up`, `systemctl`, tunnel reload, Cloudflare API calls. Command
construction and generated config are covered by self-checks; execution needs
the VM.

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
