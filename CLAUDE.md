# Facet

Local-only job-search assistant. Next.js 16 + Tailwind 4 frontend (`frontend/`),
FastAPI backend (`backend/`), SQLite at `data/tracker.db`, `agy` CLI for AI.

**Start with the `facet` skill** (`.claude/skills/facet/SKILL.md`). It carries
the whole picture — architecture, the cutting pipeline, the resume template
system, the design system, the sandbox recipes — in one read, and exists so a
session does not spend its budget rediscovering the same ground.

Deeper context after that: `CONTEXT.md` (architecture, API surface, data model,
the `agy` file-handoff trap) · `workspace/RULES.md` (truthfulness contract) ·
`AUTONOMY.md` (how to work here) · `docs/runbook.md` (production) · `PLAN.md`
(multi-user host).

## gstack

Skills from [gstack](https://github.com/garrytan/gstack), installed per-developer
at `~/.claude/skills/gstack` — **not vendored into this repo**. It is ~1.6 GB
installed with a platform-specific browser binary, and its installer registers
skills in your home directory rather than in a project, so a committed copy
would be unregistered files that still needed the same install. Install command
and the two options worth enabling here: `docs/setup.md`, appendix.

Verified against **v1.60.1.0** (`a325940`). `/gstack-upgrade` moves it forward.

**Use `/browse` for all web browsing. Never use the `mcp__claude-in-chrome__*`
tools.** `/browse` is the supported path here; the Chrome MCP tools are not.

Available — 53 skills, more than the suite's own README lists. Grouped by what
you would actually reach for:

| | |
|---|---|
| **Planning** | `/spec` · `/autoplan` · `/plan-ceo-review` · `/plan-eng-review` · `/plan-design-review` · `/plan-devex-review` · `/plan-tune` · `/office-hours` |
| **Review** | `/review` · `/design-review` · `/devex-review` · `/health` · `/retro` |
| **Design** | `/design-consultation` · `/design-shotgun` · `/design-html` · `/diagram` |
| **Ship & deploy** | `/ship` · `/land-and-deploy` · `/canary` · `/landing-report` · `/setup-deploy` |
| **Safety** | `/careful` · `/guard` · `/freeze` · `/unfreeze` · `/cso` |
| **Quality** | `/qa` · `/qa-only` · `/benchmark` · `/benchmark-models` · `/investigate` |
| **Browser** | `/browse` · `/connect-chrome` · `/open-gstack-browser` · `/scrape` · `/skillify` · `/setup-browser-cookies` · `/pair-agent` |
| **Docs** | `/document-release` · `/document-generate` · `/make-pdf` · `/learn` |
| **Context** | `/context-save` · `/context-restore` |
| **gbrain** | `/setup-gbrain` · `/sync-gbrain` |
| **Other** | `/codex` · `/gstack-upgrade` |

Also installed and **not applicable to this project** — Facet has no iOS app:
`/ios-qa` · `/ios-design-review` · `/ios-fix` · `/ios-clean` · `/ios-sync`.

## Commands

```bash
backend/.venv/bin/python scripts/check_all.py   # every backend suite (17), from backend/
cd frontend && npm run check                    # format, api, clipboard, match, jdTrim, design, interface
cd frontend && npx tsc --noEmit && npm run lint && npm run build
node extension/check.mjs
python run.py                                   # build + serve; --dev for dev servers
deploy/publish.sh                               # build into .next.incoming, swap, restart
templates/build_resume_docx_templates.py        # rebuild the seven Word shells
```

`npx eslint .` reports ~230 phantom errors from the `.next.qa` / `.next.previous`
build artifacts. Scope it: `npx eslint src scripts`.

`frontend/scripts/check-layout.mjs` is a Playwright sweep (overflow, misalignment,
page errors across breakpoints and routes). Deliberately outside `npm run check` —
it needs a running server. Point it at a local port or at production.

## Will bite you in the first ten minutes

- **`backend/.venv/bin/python`, never bare `python`** — bare is 3.8-era and dies on
  `set[str]` subscripting.
- **`data/` and `workspace/` are real user data.** Never delete or rebuild. DB
  migrations stay additive-only via `_POSTING_COLUMNS`; an existing `tracker.db`
  must open unchanged after any work.
- **Never `pkill -f <name>`.** `pkill -f "next-server"` killed the live frontend on
  :3000 and 502'd the public site for four minutes. Kill by port PID only:
  `ss -ltnp`, `lsof -ti:PORT`.
- **Ports 3000/8000 may already be serving production.** Check before launching.
- **`agy` may be absent or unauthenticated**, and WeasyPrint's native Pango/Cairo
  libs may be missing. Everything else must still work; `/status` reports both.
- **No test frameworks.** New non-trivial logic leaves one runnable `demo()`/`assert`
  check in the existing module style. Don't add pytest/jest/vitest unasked.
- **The type scale is rem, not px** — that is the Dynamic Type mechanism, and
  `check-design-system.mjs` fails the build on a px `font-size` or a px entry in
  the Tailwind scale.
- **`backdrop-filter` writes `-webkit-` first, standard second**, or the minifier
  keeps only the prefixed form and the blur silently does nothing in Firefox.

## Product boundaries — design, not oversight

No scraping: postings arrive only from a provider's public API or a feed the user
subscribed to. No auto-submit: the extension's selector format has no
`submit_selector` field and no `.click()` on a final control. `profile.json` is the
only source of truth about the user. Local-only — no telemetry, and keys are only
ever sent to the provider they belong to, never echoed back.

## Ask first

Deleting user data (`workspace/`, `data/`) · `git push` · changing the
truthfulness-mode semantics · adding a paid or cloud dependency.


---

# Sprint: Cut a Facet revamp and the resume template system

What this sprint added, why it is built the way it is, and what a future
session needs to know before changing it.

## The resume template system

Seven ATS-friendly resume templates, chosen after reading current parser
guidance (Jobscan's formatting research, Resume.io's template analysis, and
Enhancv's 2025 study across Workday, iCIMS, Greenhouse, Lever and Taleo).

### The architecture, and the one idea behind it

```
templates/resumes/_base.html     the skeleton — owns every ATS-critical decision
templates/resumes/{id}.html      seven skins: CSS, plus an optional role_entry block
templates/resumes/{id}.docx      Word shells, built by build_resume_docx_templates.py
backend/services/resume_templates.py   the registry, the date normaliser, the check
```

**One skeleton, seven skins: genuinely different documents to a person, the
same document to a machine.**

Parsers fail on a short, well-documented list — multiple columns, tables,
graphics, text in the page header or footer, non-standard section headings,
decorative fonts. Every one of those is a *structural* choice, so the base owns
all of them and no skin can opt out. Typeface, weight, rules, spacing and the
arrangement of a role's title against its dates are invisible to a parser, so
that is the entire space the skins move in.

The base guarantees: single column; contact details in the document body;
standard headings (`Professional Summary`, `Skills`, `Work Experience`,
`Projects`, `Education`, `Certifications`); no icons, images or skill bars;
reverse-chronological roles.

### The seven

| id | Name | Character | For |
|---|---|---|---|
| `chicago` | Chicago | Centred serif, ruled headings | Finance, law, consulting — **the default** |
| `zurich` | Zurich | Swiss sans, no rules, whitespace carries structure | Design, product, startups |
| `cambridge` | Cambridge | Garamond, generous measure, dates above each role | Academia, research |
| `meridian` | Meridian | Masthead name over a full rule, company before title | Senior and executive |
| `compact` | Compact | Tighter margins, type and leading | Ten years or more on one page |
| `ledger` | Ledger | Serif text, sans labels, rule between roles | Engineering, operations |
| `bulletin` | Bulletin | Section headings in a tinted band | Marketing, comms, general |

Chicago is the default because it is the closest descendant of the single
template Facet shipped before the picker existed — an existing user who never
touches the control gets very nearly the document they already had.

Six of the seven fit a realistic three-role resume on one page. Cambridge runs
to two by design; academic CVs do.

### ATS findings that are load-bearing

All measured with WeasyPrint + `pdftotext`, which is the same kind of extractor
an ATS uses. **Do not undo these.**

1. **Letter-spacing at ≥10% of the font size destroys the heading.** The
   extractor returns `P R O F E SS I O N A L S U M M A RY` — the section
   heading is gone as far as any parser is concerned. It is a *ratio*, so a
   value that is fine on an 11pt heading breaks an 8pt one; and it is
   length-dependent, so `SKILLS` survived at the same tracking where
   `PROFESSIONAL SUMMARY` did not. A template can therefore pass a casual look
   and still lose its longest heading. The cap is **8%**, enforced statically.
2. **`font-variant: small-caps` breaks extraction.** WeasyPrint synthesises it
   as separate glyph runs and the text comes out `P rofessional s ummary`.
   Banned. Cambridge uses normal-case serif headings with a hairline instead,
   which is the older academic convention anyway.
3. **`text-transform: uppercase` changes what is stored in the PDF.** Harmless —
   parsers match headings case-insensitively — but it means any assertion about
   headings has to be case-insensitive too.
4. **Dates.** `resume_templates.when()` turns `2021-03` and `3/2021` into
   `Mar 2021`, the form date extractors read most reliably, and passes anything
   it does not recognise through untouched rather than mangling a date that was
   already fine.

### The check

`backend/.venv/bin/python -m services.resume_templates` (in `check_all.py`,
~3s) renders all seven, reads the text back out, and asserts:

- the section skeleton arrives **in order**;
- contact details survive (i.e. they are in the body, not a page header);
- roles stay reverse-chronological;
- dates arrived normalised;
- the tailored bullet — the actual product of a cut — is present;
- no template contains a table, image, float, absolute positioning,
  page-margin content, `column-count`, or small-caps;
- letter-spacing stays under the ratio ceiling;
- every DOCX renders with the same content and leaves no unrendered Jinja.

This check found every one of the four findings above. None was visible by
reading the CSS.

### Persistence

`settings.json` gains `resume_template`. `POST /api/tailor` resolves it at
**enqueue** time rather than render time — a preference changed while a job is
queued must not retarget that job — persists the choice, and stamps the id on
the job payload. `resolve()` is deliberately forgiving: an unknown or retired
id falls back to the default instead of failing a request that has already been
accepted and would otherwise die thirty seconds later with nothing useful to
say.

### A bug this fixed on the way past

The previous DOCX template emitted `{{ edu.school }}` and `{{ edu.year }}`
against a context carrying `institution`, `degree` and `year`. **Every Word
export has been shipping an Education section with a blank institution line.**
It was invisible because the PDF used a different, correct template and almost
everyone downloads the PDF. Rebuilding both renderers from one description of
the document fixes it by construction, and the check now asserts across both.

## The Cut a Facet page

Same workflow — company, role, optional URL, description, truthfulness mode,
cut. Same handoff from The Rough, same draft recovery. What changed is that the
page now helps while you fill it in rather than only after you submit, and has
a shape: a header naming the three outputs, three numbered steps, a sticky
action bar.

### The eight improvements

| # | What | Where |
|---|---|---|
| 1 | **Live match pre-check** with evidence, as you paste | `components/tailor/MatchPreflight.tsx` |
| 2 | **⌘/Ctrl+Enter** cuts from anywhere in the form | `TailorForm` |
| 3 | **Draft restore is visible and reversible** | `TailorForm` |
| 4 | **Boilerplate trimmer** — offered, never automatic | `lib/jdTrim.ts` |
| 5 | **Sticky action bar** | `.cut-bar` |
| 6 | **Requirements digest** — counts requirement-shaped lines | `TailorForm` |
| 7 | **Three labelled steps** instead of one wall of inputs | `TailorForm` |
| 8 | **Template picker** | `components/tailor/TemplatePicker.tsx` |

Plus **cancellation** in `PageClient`: `DELETE /api/queue/{id}` already existed
and already killed the process tree, but nothing had ever offered it. Closing
the tab left the job running and the agy lock held for whoever was next.

### Two deliberate duplications

**`lib/match.ts` duplicates `services/matching.py`.** The page scores the
description on every keystroke of what is often a 15,000-character paste, and a
round trip per keystroke is a worse answer than shipping the vocabulary once
(`GET /api/profile/keywords` — the skill words, not the whole Stone). The risk
is handled rather than accepted: `match.check.ts` runs both implementations
over the same fixtures and asserts they agree to the digit, and reads
`WEAK_MATCH_THRESHOLD` out of the Python source rather than trusting a comment.

It immediately earned its keep. The browser was being *more correct* than the
server about blank keywords — Python counts an empty term in the denominator,
so a stray blank entry depresses every score slightly. **The backend is the
authority and its threshold is calibrated against its own behaviour, so the
quirk is mirrored, not fixed one-sidedly.** If it is ever worth fixing, fix
`matching.py` first and let the browser follow.

**The picker's previews are drawn, not screenshotted.** Seven thumbnails would
be seven files to keep in step with seven templates, and they would go stale
silently the first time a template changed. Each card renders a miniature from
the same `traits` the backend publishes with the template, so a preview cannot
claim a layout the registry does not describe.

### Three bugs the probes caught

- **`69%of your Stone's terms`** — JSX drops whitespace at a line end. Needs an
  explicit `{" "}`.
- **The trim offer never appeared** on exactly the kind of posting it was built
  for: the length threshold was set by guesswork at 3,000 characters and a
  realistic posting with role, requirements, benefits and an EEO paragraph came
  to 2,200. What decides whether the offer is worth making is how much it would
  remove, not how long the input is.
- **The generic heading detector was too loose.** At twelve words, the first
  line of a wrapped EEO paragraph read as a heading and ended the dropped
  section early, so the boilerplate survived the trim. Six words excludes every
  wrapped prose line and still admits every real posting heading.

The trimmer's check is weighted deliberately toward *never removing the wrong
thing*: failing to trim a benefits section costs a little budget, but trimming a
requirements section costs the user a resume built from half a posting, and they
would have no way to know.
