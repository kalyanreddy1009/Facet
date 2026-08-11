---
name: facet
description: >
  Complete working knowledge of the Facet codebase — a local-only job-search
  assistant (Next.js 16 + Tailwind 4 frontend, FastAPI + SQLite backend, the
  `agy` CLI for AI). Load this before doing anything in the Facet repo:
  architecture, the cutting pipeline, the resume template system, the design
  system, the non-negotiable product boundaries, the sandbox recipes for
  reviewing pages that need a session, and the traps that have actually cost
  time here. Use it for any task touching /home/ubuntu/Facet — feature work,
  debugging, review, deployment — so a session does not have to rediscover the
  same ground.
---

# Facet

A **local-only job-search assistant**. One "Stone" — a permanent, honest record
of the user's real background — gets "cut" into a tailored resume, cover letter
and recruiter pitch per job. The gemcutting metaphor is load-bearing in code
and copy:

| Word | Means | Lives at |
|---|---|---|
| **Stone** | the user's real background, `workspace/profile.json` | `/stone` |
| **Rough** | the raw pool of gathered postings | `/rough` |
| **Facet** | one tailored application | `/tailor` |
| **Cabinet** | the tracker | `/cabinet` |

Read `OVERVIEW.md` first — one dense file covering the whole app, and the one
kept current; where anything here disagrees with it, OVERVIEW is newer. Then
`CLAUDE.md` (short, the rules). This skill goes deeper than OVERVIEW on the
design system, the cutting pipeline and the sandbox recipes.

---

## 1. Before you touch anything

These have each cost real time or real damage.

- **`backend/.venv/bin/python`, never bare `python`.** Bare is 3.8-era and dies
  on `set[str]`. Module checks want `env -u PYTHONPATH` too, or a stray
  `PYTHONPATH` shadows `services`.
- **`data/` and `workspace/` are real user data.** Never delete or rebuild.
  Migrations stay additive-only via `_POSTING_COLUMNS`.
- **Never `pkill -f <name>`.** `pkill -f "next-server"` killed the live
  frontend and 502'd the public site for four minutes. Kill by port PID:
  `ss -ltnp | grep :PORT`, then `kill <pid>`. Note `lsof -ti:PORT` misses
  IPv6-bound listeners — `ss` does not.
- **Ports 3000/8000 are production.** Sandboxes go on 3100/8100.
- **`agy` may be absent**, and WeasyPrint's native libs may be missing.
  Everything else must still work; `/status` reports both.
- **No test frameworks.** New non-trivial logic leaves one runnable
  `demo()`/`assert` in the existing style. Don't add pytest/jest/vitest.
- **The type scale is rem.** A px `font-size` fails `check-design-system.mjs`.
- **`backdrop-filter` is the most expensive property in `globals.css`** and was
  deliberately removed from the nav and the landing cards. Don't reintroduce it
  on anything that composites during scroll.

## 2. Product boundaries — design, not oversight

- **Nothing scrapes or logs into a job platform.** Postings arrive only via a
  provider's public API, an aggregator's API, or a feed the user subscribed to.
- **Nothing auto-submits.** The extension's selector format has no
  `submit_selector` field and no `.click()` on a final control.
- **`profile.json` is the only source of truth about the user.** Employers,
  titles and dates are never touched. Truthfulness modes: `strict` (default)
  and `inferred_adjacent` (may claim a skill directly implied by a real
  accomplishment, always reported separately).
- **Local-only.** No telemetry; keys live in `data/settings.json` or env and go
  only to the provider they belong to, never echoed back.

Ask before: deleting user data, `git push`, changing truthfulness semantics,
adding a paid/cloud dependency.

## 3. Layout

| Piece | What |
|---|---|
| `frontend/` | Next.js 16 app router, React 19, TS, Tailwind 4, framer-motion, recharts. Port 3000. |
| `backend/` | FastAPI + uvicorn, Python 3.12 (`backend/.venv/bin/python`). Entrypoint is `main:app`. Port 8000. |
| `data/` | `tracker.db`, `queue.db`, `settings.json`, `feeds.json`, `logs/`, `exports/`. Gitignored. `FACET_DATA_DIR`. |
| `workspace/` | `profile.json`, `master_resume.md`, `RULES.md`, agy scratch. Gitignored. `FACET_WORKSPACE_DIR`. |
| `templates/` | `resumes/` (the seven, HTML + DOCX), `cover_letter_template.html`, legacy `resume_template.*`. |
| `extension/` | Chrome MV3 "Apply Assist" — fills forms, never submits. |

**Every path comes from `backend/services/paths.py`.** Nothing computes its own
location from `__file__`.

## 4. The cutting pipeline

`POST /api/tailor` validates, resolves the resume template, and returns **202 +
`job_id`**. The browser polls `/api/queue/{id}`. `run_tailor_job` then:

1. Local keyword pre-check (`matching.keyword_overlap_score`) — warns, never blocks.
2. Stages inputs in a per-job directory (`prepare_job_dir`) — the old code wrote
   into the shared workspace before taking the agy lock, so a second request
   could silently retarget the first.
3. `run_agy` under a cross-process lock → `tailored_fields.json`.
4. `build_resume_context` merges profile (fixed) with tailored fields (narrow).
5. Renders PDF + DOCX + cover letter into `data/exports/`, writes an
   `applications` row.

### The `agy` trap — read before touching AI code

`agy -p` **silently produces nothing useful on stdout** when not attached to a
TTY, which is always true for a subprocess. So every call uses a **file-handoff
pattern**: write inputs, delete any stale output, run agy with an instruction
naming exactly which file to read/write, read the result off disk (300s
timeout). Second trap: agy sometimes writes into its own scratch directory
instead of its launch directory — fixed by passing `--add-dir <workspace>` on
**every** call. Without it the handoff silently breaks.

## 5. The resume template system

Seven templates, added in the Cut a Facet sprint. **`backend/services/resume_templates.py`
is the registry and the authority.**

```
templates/resumes/_base.html     the skeleton — owns every ATS-critical decision
templates/resumes/{id}.html      seven skins: styles + optional role_entry block
templates/resumes/{id}.docx      built by templates/build_resume_docx_templates.py
```

**The design in one sentence: one skeleton, seven skins — different to a person,
identical to a parser.** The base owns single-column layout, contact details in
the body, standard section headings ("Professional Summary", "Skills", "Work
Experience", "Projects", "Education", "Certifications"), no tables/images/
page-margin content, and reverse-chronological roles. A skin may only change
what a parser never reads.

The seven, in picker order: **Chicago** (traditional, centred serif — the
default and the closest descendant of the pre-sprint template), **Zurich**
(Swiss sans), **Cambridge** (academic Garamond, dates above each role),
**Meridian** (executive masthead, company before title), **Compact** (dense,
fits a long history on one page), **Ledger** (serif text, sans labels, rule
between roles), **Bulletin** (tinted heading bands).

### ATS findings that are load-bearing — do not undo these

Measured with WeasyPrint + `pdftotext`, which is the same kind of extractor an
ATS uses:

- **Letter-spacing at ≥10% of the font size destroys the heading.** `pdftotext`
  returns `P R O F E SS I O N A L S U M M A RY`. It is a *ratio*, so a value
  that is fine on an 11pt heading breaks an 8pt one, and it is length-dependent
  so short headings can pass while long ones fail. The cap is **8%**, enforced
  by a static check that parses each CSS block.
- **`font-variant: small-caps` breaks extraction** — WeasyPrint synthesises it
  as separate glyph runs and the text comes out `P rofessional s ummary`.
  Banned by the same check.
- **`text-transform: uppercase` changes what is stored in the PDF.** Harmless
  (parsers match case-insensitively) but it means heading assertions must be
  case-insensitive.
- Dates are normalised by `resume_templates.when()`: `2021-03` and `3/2021`
  become `Mar 2021`; anything unrecognised passes through untouched.

### The check

`backend/.venv/bin/python -m services.resume_templates` renders all seven,
extracts the text back with `pdftotext`, and asserts the section skeleton
arrives in order, contact details survive, dates are normalised, the tailored
bullet is present, roles stay reverse-chronological, and both renderers agree.
It is in `check_all.py` and takes ~3s.

### Preference

`settings.json` holds `resume_template`. `POST /api/tailor` resolves it at
*enqueue* time (not render time) so a preference changed while a job is queued
does not retarget it, persists the choice, and stamps the id on the job
payload. `resolve()` is deliberately forgiving — an unknown id falls back to
the default rather than failing an already-accepted request.

## 6. Cut a Facet page

`frontend/src/app/tailor/PageClient.tsx` + `components/tailor/`. Three numbered
steps, a sticky action bar, and eight improvements from the sprint:

1. `MatchPreflight` — live overlap score with evidence, as you paste.
2. ⌘/Ctrl+Enter to cut.
3. Visible, reversible draft restore.
4. Boilerplate trimmer (`lib/jdTrim.ts`) — offered, never automatic.
5. Sticky action bar (`.cut-bar`).
6. Requirements digest — counts requirement-shaped lines.
7. Three labelled steps instead of one wall of inputs.
8. `TemplatePicker` — collapsed by default, previews drawn from the backend's
   published `traits` so they cannot claim a layout the renderer lacks.

**`lib/match.ts` duplicates `services/matching.py` on purpose** (scoring on
every keystroke of a 15,000-char paste; a round trip per keystroke is worse).
`match.check.ts` runs both over the same fixtures and asserts they agree — it
has already caught the browser being "more correct" than the server about blank
keywords, which would have put a number on screen the backend disagreed with.
**The backend is the authority; mirror its quirks rather than fixing them
one-sidedly.**

## 7. Design system

Dark teal glass, and one theme: the `:root` values are the whole palette —
there is no light variant and no `prefers-color-scheme` branch. Read a token
from `:root` before assuming.

A dark floor under one WebGL field (`components/ui/AmbientShader`, mounted once
in the root layout), and every surface above it a translucent white over a blur
— `--glass-1/2/3`. `--surface-1` is the one opaque tone, for the surfaces that
cannot be seen through at all (the tab bar, a resume preview). **One** accent
(`--accent` `#4fb4dc` as fill, `--accent-text` `#82d1f1` as ink).
Green/amber/red strictly for status — if it isn't reporting state, it isn't
coloured. `--glint` only in the field, the hero, and the travelling
`.wordmark` gradient. Depth = a cyan 1px edge + a translucent surface + an
inner glow. Inter for UI, JetBrains Mono for numbers.

The blur is real and it is rationed. Anything composited on every scroll frame
— `.cut-bar`, `.tab-bar` — is opaque and pays nothing; everything else is
glass. That trade is the reason the landing page scrolls at 60fps with sixteen
panes on it.

**Sizing is rem and that is load-bearing** — it is how Dynamic Type works.
`--control-h` is `2rem`, lifting to `2.5rem` under `pointer: coarse`. Text
containers take `min-height`, never `height`.

Motion: four durations (120/200/320/520ms), four curves. All three settings are
answered: `prefers-reduced-motion`, `prefers-reduced-transparency`,
`prefers-contrast: more`.

Two rules that exist because breaking them shipped bugs: `.btn-cap` is a fixed
20px disc for one icon, never a label; any `backdrop-filter` writes `-webkit-`
**first**, or the minifier keeps only the prefixed form and the blur silently
does nothing in Firefox.

## 8. Commands

```bash
backend/.venv/bin/python scripts/check_all.py       # 17 suites, from backend/
cd frontend && npm run check                        # format, api, clipboard, match, jdTrim, design, interface
cd frontend && npx tsc --noEmit && npx eslint src scripts
node extension/check.mjs
node frontend/scripts/check-layout.mjs <origin>     # needs a running server
python run.py                                       # build + serve; --dev for dev servers
deploy/publish.sh                                   # build into .next.incoming, swap, restart
templates/build_resume_docx_templates.py            # rebuild the seven DOCX shells
```

`npx eslint .` reports ~230 phantom errors from `.next.qa` / `.next.previous`
build artifacts. Scope it to `src scripts`.

## 9. Reviewing a page that needs a session

Most pages redirect to `/login` without one, which is why `/admin` went
unreviewed for a long time. **`BACKEND_ORIGIN` is a build arg, not runtime** —
pointing a sandbox frontend at a sandbox backend requires a rebuild, not just
an env var on `next start`.

**Single-user sandbox** (authenticated automatically):

```bash
SB=/tmp/facet-sandbox; mkdir -p $SB/data $SB/workspace
cp workspace/RULES.md $SB/workspace/; # plus a profile.json fixture
cd backend && env -u FACET_MULTIUSER \
  FACET_DATA_DIR=$SB/data FACET_WORKSPACE_DIR=$SB/workspace FACET_QUEUE_DB=$SB/data/queue.db \
  .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8100 &
cd frontend && BACKEND_ORIGIN=http://127.0.0.1:8100 NEXT_DIST_DIR=.next.qa npx next build
BACKEND_ORIGIN=http://127.0.0.1:8100 NEXT_DIST_DIR=.next.qa npx next start -p 3100
```

**Multi-user** (the only way to see `/admin`): add
`FACET_MULTIUSER=1 FACET_BIND_HOST=127.0.0.1 FACET_INSECURE_COOKIES=1
FACET_ADMIN_EMAIL=…`, seed users via `store.create_user_row` / `set_password` /
`set_status` / `set_admin`, and log in with Playwright — the session is seeded
server-side through `SessionSeedContext`, so client-side `page.route()` mocking
cannot bypass the guard.

Tear down **by port PID**, never by name.

## 10. How to work here

- Ground every change in the running app and read every file it touches before
  editing. No fix from inference alone.
- Reuse `components/ui/` and `lib/` before writing anything new. Native HTML
  and CSS before JS; existing deps before new ones.
- Every async surface has all four states: loading, empty, error, success.
  Empty states say what to do next.
- **Measure, don't inspect.** The findings in this file that mattered most —
  the letter-spacing threshold, the `truncate`/`min-width` overflow, the
  reduced-motion specificity loss — were all invisible to reading and obvious
  to a probe.
- Append one line to `CHANGELOG.md`: what changed, why, what you left out.
