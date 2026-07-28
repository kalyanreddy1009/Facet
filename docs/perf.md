# Performance baseline

Measured 2026-07-26 on the live `data/tracker.db` (906 non-dismissed postings).
Every number here was observed, not estimated. Where a target is already met,
nothing was changed — an optimization without a number attached doesn't land.

## Bundle — production build (`npm run build`)

| Route | Route size | First Load JS |
|---|---|---|
| `/` | 441 B | 102 kB |
| `/welcome` | 174 B | 102 kB |
| `/rough` | 9.35 kB | 146 kB |
| `/cabinet` | 3.71 kB | 140 kB |
| `/tailor` | 7.71 kB | 141 kB |
| `/stone` | 5.21 kB | 138 kB |
| `/status` | 7.94 kB | 95.4 kB |
| shared by all | — | 87.4 kB |

**Three of Part C's bundle items were already done before this pass. Verified,
not assumed:**

- **`recharts` is already dynamically imported** via `next/dynamic` in
  `app/cabinet/page.tsx`, and is imported nowhere but `cabinet/FacetsView.tsx`
  and `cabinet/ApplicationsView.tsx`. It is in no static chunk and no other
  route's graph. Nothing to split.
- **Fonts are already self-hosted and correct** — `next/font/google` in
  `app/layout.tsx` with `display: "swap"`, `latin` subset, automatic preload.
  No CDN reference exists anywhere in source or CSS, so the offline guarantee
  holds. The suspected "easy win" isn't there.
- **`lucide-react` is already tree-shakeable** — every one of ~21 import sites
  uses individual named imports, never a barrel or namespace import; 37 distinct
  icons across the app. Its 29 MB on disk in `node_modules` is irrelevant to
  shipped weight; the built shared chunk is 87.4 kB total.

`framer-motion` is statically imported and reaches `/rough`, `/cabinet`,
`/tailor`, `/stone` (mostly via `Toaster`, `LoadingOverlay`, `NavBar`).
**Not removed, deliberately:** 146 kB First Load on the heaviest route is not
a problem worth a risky rewrite of every motion surface, and it is what
currently implements the reduced-motion path (`useReducedMotion` in 6 files).
Revisit only if First Load JS becomes a measured problem.

> ⚠️ A cautionary note for anyone re-measuring: running `npm run dev`
> overwrites `.next` with unminified dev chunks (`main-app.js` ~5.8 MB). Those
> are not shippable sizes. Always re-run `npm run build` before reading bundle
> numbers.

## API latency — measured over HTTP, 12 runs each, p50 / max

| Endpoint | p50 | max |
|---|---|---|
| `GET /api/jobs?limit=30` | 15.7 ms | 21.4 ms |
| `GET /api/jobs?limit=30&q=python` | 14.3 ms | 23.8 ms |
| `GET /api/jobs?limit=30&sort=recent` | 15.3 ms | 15.8 ms |
| `GET /api/jobs/facets` | 17.3 ms | 23.4 ms |

Comfortably inside the `/rough` first-meaningful-paint budget (< 1.2 s); the
data layer is not the constraint on any page.

## SQLite — `EXPLAIN QUERY PLAN`, and why no index was added

Plan for the deduped default query:

```
SEARCH seen_postings USING INTEGER PRIMARY KEY (rowid=?)
LIST SUBQUERY 1
  SEARCH seen_postings USING INDEX idx_postings_rank (dismissed=?)
  USE TEMP B-TREE FOR GROUP BY
  USE TEMP B-TREE FOR ORDER BY
```

Pure SQL cost, p50 over 25 runs, 906 rows:

| Query | p50 |
|---|---|
| raw, no dedup, `sort=match` | **0.18 ms** |
| deduped `sort=match` | 4.13 ms |
| deduped `sort=recent` | 4.51 ms |
| deduped `sort=company` | 3.71 ms |
| deduped `sort=salary` | 3.69 ms |
| the `keep_ids` subquery alone | 3.11 ms |

**Part C asks for indexes on `company` and `promoted`. Not added, with a
reason:** the plan shows the cost is the GROUP BY temp B-tree, not the ORDER
BY, and the spread across all four sorts is 3.7–4.5 ms — i.e. the sort column
barely moves it. An index on `company` cannot help while a full grouping scan
dominates, and each new index costs write time on every sync upsert. There is
no measurement that justifies them today.

**Known ceiling (the honest cost of read-time dedup).** Grouping on
`dedup_key()` calls a Python function once per row, so it is O(rows) and
un-indexable: ~3.5 ms at 906 rows, so ~200 ms at 50k. That is fine now and
will not be at 10× the data. Upgrade path when it matters: add a nullable
`dedup_key TEXT` column via the existing additive `_POSTING_COLUMNS`
migration, backfill it on sync next to `match_score`, index it, and group on
the column instead of the function. No schema rewrite required.

## Browser-side Core Web Vitals — measured 2026-07-28

Chrome DevTools performance traces, **production build served by `next start`**,
backend live on :8000, live DB (1,166 non-dismissed postings by this date), no
CPU or network throttling, localhost. Every number observed, not estimated.

| Target | Budget | Measured | |
|---|---|---|---|
| `/welcome` LCP | < 1.5 s | **338 ms** (TTFB 9 ms, render delay 329 ms) | ✅ |
| `/rough` LCP, one page of postings | < 1.2 s | **447 ms / 717 ms** (two runs) | ✅ |
| CLS, both pages | < 0.05 | **0.00** | ✅ |
| INP while typing in the filter | < 200 ms | **40 ms** | ✅ |
| `python run.py` → `/welcome` answering | — | **39 s** cold (installs + migrate + `next dev` compile) | — |
| Console errors/warnings, prod build | zero | **zero** | ✅ |

Two honest caveats on those numbers:

- **The `/rough` LCP spread is real.** 447 ms and 717 ms on identical builds and
  the same machine. Run-to-run variance on an unthrottled localhost is wide;
  treat < 1.2 s as met with room, not as a 447 ms guarantee. A mid-tier machine
  under load will be slower than both.
- **The 39 s startup is the *cold* path** and is dominated by dependency checks
  and Next's dev compile, not by the app. It is not the steady-state number —
  a warm `next start` answers in about a second.

Nothing was optimized in response to these, because nothing needed to be: every
target passes with margin, and an optimization without a number attached doesn't
land. The one real finding from the traces was a DevTools *issue* (not an error)
— four form fields with no `id`/`name`, which blocks browser autofill. Fixed in
`SearchBar` and `FilterRail`.

### Where the time actually goes on `/rough`

Almost all of it is render delay, not network: TTFB is 6–8 ms and the API
answers in ~15 ms. The LCP element is a job card, so the cost is React
hydrating the shell plus the first paint of 30 rows. `content-visibility` on
`.list-row` is doing its job — CLS stayed at exactly 0.00 across every trace,
which is what `contain-intrinsic-size: auto 140px` is for. No scrollbar jump was
observed, so no change was made.
