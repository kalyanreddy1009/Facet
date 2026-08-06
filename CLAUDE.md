# Facet

Local-only job-search assistant. Next.js 16 + Tailwind 4 frontend (`frontend/`),
FastAPI backend (`backend/`), SQLite at `data/tracker.db`, `agy` CLI for AI.

Deeper context, in order of usefulness: `CONTEXT.md` (architecture, API surface,
data model, the `agy` file-handoff trap) · `workspace/RULES.md` (truthfulness
contract) · `AUTONOMY.md` (how to work here) · `docs/runbook.md` (production) ·
`PLAN.md` (multi-user host).

## Commands

```bash
backend/.venv/bin/python scripts/check_all.py   # every backend suite
cd frontend && npm run check                    # design system, interface, api cache
cd frontend && npx tsc --noEmit && npm run lint && npm run build
node extension/check.mjs
python run.py                                   # build + serve; --dev for dev servers
deploy/publish.sh                               # build into .next.incoming, swap, restart
```

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
