# UI audit — token consistency, states, accessibility

Audited 2026-07-26 across every `.tsx` under `frontend/src`, against the token
layer in `app/globals.css` and `tailwind.config.ts`.

**Headline: the design system is in good shape.** A full sweep of every file
turned up only three hardcoded values that duplicate an existing token. Most
things that *looked* like violations are deliberate and documented below, so
they don't get "fixed" into regressions later.

Per the task's instruction, the **refactor items in §1 were proposed and awaited
approval**; only the items marked ✅ APPLIED were changed in the 07-26 pass.
**All four were approved and applied on 2026-07-28** — see §1.

> §§4–7 were added 2026-07-28: Part A's visual patterns, the WCAG measurement
> that §4 previously said must not be claimed until run, and the keyboard and
> four-states gaps this document left open.

---

## 1. Token consistency — proposed, awaiting approval

| File:line | Hardcoded | Proposed |
|---|---|---|
| `components/ui/Sheet.tsx:47` | `bg-black/55` overlay | No overlay token exists. Either add `--overlay` to the token layer and use it, or leave as-is — it's the one scrim in the app, and a token with one caller is the abstraction the system already avoids. **Recommend: leave, or add the token only if a second scrim appears.** |
| `components/ui/Sheet.tsx:64` | `duration: 0.2` | `0.16` (`--t`). 200ms is not in the token set {100, 160, 260}. |
| `components/status/CheckRow.tsx:42` | `mt-[7px]` | `mt-2` (8px), unless the 7px is optical alignment against a 14px glyph — check visually before changing. |
| `components/tailor/TailorResult.tsx:45` | `min-h-[26px]` | Matches `.btn-sm` height; use that scale or a token rather than the literal. |

**Resolution (2026-07-28) — all four approved and applied:**

- `Sheet` overlay → new `--overlay` token, used via `bg-overlay`.
- `Sheet` panel `duration: 0.2` → `0.16`, now imported from `lib/motion.ts`
  rather than written as a literal at all.
- `CheckRow` `mt-[7px]` → `mt-2`. Checked visually first: the 1px shift against
  the 14px glyph is not perceptible, and it puts the dot on the 8px grid.
- `TailorResult` `min-h-[26px]` → `min-h-[var(--control-h-sm)]`. This turned up
  a wider duplicate: `.btn`/`.btn-lg`/`.btn-sm` and `.field`/`.field-lg` each
  hardcoded the same 26/32/38px heights independently, which is how a 26px and
  a 27px control end up side by side. Now `--control-h-sm` / `--control-h` /
  `--control-h-lg`, defined once.

Nothing else in the app hardcodes a colour, radius, easing, or duration that a
token already covers.

### Deliberate, not findings — do not "fix" these

- **`/welcome` hero type scale** (`LandingContent.tsx`) — intentionally the one
  expressive surface; every other page stays 13–14px body.
- **framer-motion `transition` literals** (`Segmented`, `Toaster`, `NavBar`,
  `cabinet/page`) — all already use `0.16` and `[0.16, 1, 0.3, 1]`, i.e. the
  numeric values of `--t` and `--ease-out`. framer-motion can't read CSS custom
  properties in a transition object, so the literal is unavoidable and correct.
- **SVG stroke/opacity** in `StoneGraphic`, `NavBar`, chart theme — decorative
  illustration and third-party chart internals, outside the component token
  system.
- **`ScoreRing` geometry** (`size=104`, `stroke=6`) — visualization
  proportions, not spacing tokens.
- **Responsive clamps** (`w-[min(30rem,100vw)]`, toast width, filter-rail
  width) — layout constraints, not design tokens.
- **`rootMargin: "600px"`** on the infinite-scroll observer — a performance
  tuning value.

---

## 2. Accessibility and interactive states

### ✅ APPLIED in this pass

- `components/ui/AgyHealthBanner.tsx` — dismiss button had `hover:text-text`
  with no focus equivalent → added `focus-visible:text-text`.
- `components/jobs/SearchBar.tsx` — clear-search button, same gap → added
  `focus-visible:text-text`.
- `components/cabinet/FacetsView.tsx` — `<Line>` animated regardless of
  `prefers-reduced-motion` → `isAnimationActive={!reduced}`.
- `components/cabinet/ApplicationsView.tsx` — `<Funnel isAnimationActive>` was
  hardcoded true → `isAnimationActive={!reduced}`.

The last two matter because the `prefers-reduced-motion` block in `globals.css`
only collapses **CSS** animation. recharts animates in JS and was slipping
straight past it — the one real hole in an otherwise complete reduced-motion
story (`useReducedMotion` is already wired through `Sheet`, `NavBar`,
`Segmented`, `Toaster`, `LoadingOverlay`, `ScoreRing`, `cabinet/page`, and
`LandingContent` uses `matchMedia` directly).

### Open — keyboard, ranked by user impact

1. **`app/rough/page.tsx:217–234` — the mobile filter overlay is a modal
   without modal behaviour.** No focus trap (Tab escapes to the page behind),
   no Escape handler, no focus restore on close. `components/ui/Sheet.tsx`
   already implements Escape + focus-in + scroll lock + focus restore correctly;
   the fix is to reuse that behaviour rather than write a second one. Note even
   `Sheet` lacks an actual Tab *trap* — worth adding once, in `Sheet`, and
   having the overlay use it.
2. **`components/ui/Segmented.tsx:38–50`** — `role="tab"` buttons with click
   handlers only. A tablist should move focus on ArrowLeft/ArrowRight.
3. **`components/jobs/FilterRail.tsx:45–68`** — radio-style choices without
   arrow-key navigation within the group.

`components/status/CheckRow.tsx` already implements Enter/Space on its
expandable rows correctly.

### Screen reader

Spot-checked clean: icon-only Dismiss has `aria-label`, `LoadingOverlay` has
`role="status" aria-live="polite"`, `/rough` result count is an `aria-live`
region with `aria-busy` on the list, `<details>` gets `aria-expanded` natively.
No findings.

---

## 3. Four states per page

| Page | Loading | Empty | Error | Success |
|---|---|---|---|---|
| `/welcome` | ⚠️ none while stats fetch | shows `—` | ⚠️ silent `.catch()` | ✅ |
| `/tailor` | ✅ LoadingOverlay | n/a | ✅ toast | ✅ |
| `/rough` | ✅ JobListSkeleton | ✅ EmptyState, distinguishes "nothing gathered" from "no match" | ✅ toast | ✅ |
| `/cabinet` | ✅ Skeleton | ✅ | ⚠️ toast fires, but skeletons persist forever with no retry | ✅ |
| `/stone` | ✅ Skeleton | ✅ | ✅ toast | ✅ |
| `/status` | ✅ Skeleton | n/a | ✅ error panels | ✅ |

Two open gaps, both low-severity:

- `/welcome` — no loading indicator while the summary loads, and its fetch
  failure is swallowed by an empty `.catch()`. A failed stats call should not be
  invisible.
- `/cabinet` — if `loadAll()` throws, the skeleton never resolves. Needs a
  terminal error state with a retry, not just a toast.

---

## 4. Part A — the four adopted visual patterns

All four shipped 2026-07-28.

1. **`/welcome` display type.** `text-4xl` → the `hero` scale, retuned to
   `clamp(2.75rem, 7vw, 5rem)` at `line-height: 0.95`. Leading under 1 only
   reads at that size, which is exactly why it is confined to this page; the
   hero grid also went `1.1fr/0.9fr` → `1.25fr/0.75fr` and `StoneGraphic`
   300 → 260 so the headline is unambiguously the dominant element. No new
   font, no display face — Inter, as specified. Every other page is untouched
   at 13–14px body.
2. **Trailing icon cap.** New `.btn-cap` in `globals.css` + a `cap` prop on
   `Button`. Applied to exactly one primary action per view: "Cut a facet",
   "Save stone", "Search all boards", and the landing "Find jobs". **Inverted
   from the source spec on purpose** — the source put an accent-filled circle
   on a light button; our primary button *is* the accent, so an accent circle
   on it would be invisible. The cap is `--on-accent` filled with an
   `--accent` glyph. It sits inside the existing 32px/38px control height and
   does not grow it. `border-radius: 100px` appears here and nowhere else.
   The cap is deliberately absent while a button is `loading` (the spinner
   owns that slot) and while `disabled` on `/tailor` and `/stone`, so it reads
   as an affordance rather than decoration.
3. **`OptionCards`** (`components/ui/OptionCards.tsx`) — mutually-exclusive
   card choice, selected state is a 1px `--accent` border on the *same*
   surface step. No fill change, no shadow, no scale. Replaced the ad-hoc
   radiogroup in `TailorForm` (which did change fill, to `accent-soft`).
   **One caller today.** The task asked for a real reusable component rather
   than repetition, and it is one; but `SourcesSheet` and `FilterRail` were
   checked and neither is a mutually-exclusive *card* picker, so no second
   caller was invented to justify it.
4. **Easing.** One documented set in `globals.css`: `--ease` (state change in
   place), `--ease-out` (entrances, now `cubic-bezier(0.2, 0.8, 0.2, 1)` per
   the spec), `--ease-exit` (`linear`). Durations stayed 100–200 ms; none of
   the source's 300–800 ms springs were imported. The five framer-motion
   sites that had to duplicate the numbers now import them from
   `lib/motion.ts` instead of hardcoding `[0.16, 1, 0.3, 1]` five times.

**Everything in the REJECT list stayed rejected** — no glassmorphism beyond the
pre-existing `.chrome` blur (which predates this task and is documented as the
one place blur is allowed), no coloured or diffuse shadows, no gradients, no
pink, no parallax, no WebGL/GSAP, no particles, no `overflow: hidden` on body,
no hover-scale, no decorative motion, no pill walls.

---

## 5. WCAG AA — measured 2026-07-28

Computed from the actual token values (sRGB relative luminance, WCAG 2.1
formula), every text/surface and border/surface pair. This section replaces the
earlier "not measured — do not record as passing" note.

**The audit found three real AA failures in the token layer itself.** All three
were confirmed with the user before any token changed, because they alter the
look of the whole app.

### Before → after

| Pair | Before | After | Need |
|---|---|---|---|
| White label on primary button | 3.76:1 ❌ | **5.08:1** ✅ | 4.5 |
| …on hover / press | 2.95 / 4.93 ❌ | **4.60 / 6.54** ✅ | 4.5 |
| `--text-faint` on bg → surface-3 | 3.57–4.47:1 ❌ | **4.82–6.02:1** ✅ | 4.5 |
| `.field` / `.btn-default` boundary | 1.49–1.60:1 ❌ | **3.02–3.22:1** ✅ | 3.0 |
| `.field:hover` boundary | 1.9:1 ❌ | **4.13–4.69:1** ✅ | 3.0 |
| Accent as *text* (toast action, card title hover, `.badge-accent`) | 4.59–5.17:1 ✅ | **4.59–5.17:1** ✅ | 4.5 |
| Focus ring on bg | 5.17:1 ✅ | **3.83:1** ✅ | 3.0 |
| `--text` and `--text-dim`, every surface | 5.60–16.49:1 ✅ | unchanged ✅ | 4.5 |
| `--ok` / `--warn` / `--danger`, every real surface | 4.58–7.70:1 ✅ | unchanged ✅ | 4.5 |

### The one finding worth understanding

**A single indigo cannot pass in both roles.** An indigo dark enough for white
label text (≥4.5:1) is too dark to *be* text on a dark surface, and the
converse. That is colour maths, not taste. So the accent is now one hue at two
lightnesses, and the rule is written into `globals.css`:

- `--accent: #3a68d6` — **fills**: buttons, the checkbox, the nav indicator,
  the focus ring, the `OptionCards` selected border.
- `--accent-text: #4c7ef3` — **ink**: accent used as text on a dark surface.
  This is the original accent, preserved exactly where the brief wanted it.

Applying the global darkening alone would have fixed the button and broken the
four accent-as-text sites (down to 2.72–3.83:1) — trading one failure for
another. Splitting the role keeps both sides passing.

Also changed: `--text-faint` `#6e7a8c` → `#8590a1`, and a new
`--border-control: rgba(230,237,246,0.38)` used **only** by `.field` and
`.btn-default`.

### Deliberately still failing, with reasons

- **`--border` / `--border-strong` at 1.2–1.6:1.** These are the decorative
  depth cue on panels and dividers, not a control boundary. WCAG 1.4.11 covers
  "non-text content required to identify a UI component" — a panel edge isn't
  one, and every panel's content is identifiable without it. Raising these to
  3:1 would replace the design rather than refine it. The controls that *are*
  covered now use `--border-control`.
- **Surface steps against each other at 1.05–1.13:1.** Same reasoning, and the
  same conclusion: the steps are depth, the 1px border is the boundary.
- **`--text-ghost` at 1.80–2.54:1.** Placeholder text only. Every field it
  appears in has a real `<label>` or `aria-label` carrying the same
  information, and the placeholders are examples ("Stripe", "https://…"), not
  instructions. Nothing is lost if it can't be read.
- **`--text-faint` on `--surface-4` (4.28:1)** and **`--accent` on
  `--surface-4` (2.72:1)**. Hypothetical: `--surface-4` is used for exactly one
  thing in the entire app, the scrollbar thumb. No text or accent ever sits on
  it. Verified by grep, not assumed.

Re-run the numbers with the throwaway script in the task notes, or recompute
from the tokens — there is deliberately no permanent contrast tool in the repo,
because it would duplicate the token values and drift from them.

---

## 6. Keyboard — closed since the last pass

- **`useModal` (`lib/useModal.ts`)** now carries the whole modal contract:
  Escape, focus in, **Tab trap** (the piece `Sheet` was missing), scroll lock,
  focus restore. `Sheet` uses it, and so does `/rough`'s mobile filter overlay,
  which previously had none of the five. One hook, two callers — which is why
  it's a hook and not a second copy inside `Sheet`.
- **`onRovingKeyDown` (`lib/rovingFocus.ts`)** gives a `radiogroup`/`tablist`
  the behaviour a native radio group has for free: one tab stop for the group,
  arrows between the options, Home/End to the ends, selection follows focus.
  Wired into `Segmented` (was click-only despite `role="tab"`), all five
  `FilterRail` groups, and `OptionCards`. Items carry `tabIndex={selected ? 0 : -1}`
  so the group really is one stop.
- **Focus-visible parity.** `Toaster`'s dismiss button and its undo action had
  `hover:` styling with no focus equivalent — the last two instances of the
  gap fixed in `AgyHealthBanner`/`SearchBar` last pass. Grep now finds no
  `hover:` colour change without a `focus-visible:` twin.

## 7. Four states — closed since the last pass

Both gaps from §3 are fixed:

- **`/welcome`** — the stats fetch no longer swallows its failure in an empty
  `.catch()`. Loading shows a `Skeleton` in a height-reserved box (so the panel
  cannot shift), and a failure says so: *"Couldn't reach the local backend, so
  these are unknown — not zero."* Showing "0 facets cut" when the backend is
  down is a different and wrong claim.
- **`/cabinet`** — a failed `loadAll()` now renders a terminal `EmptyState` with
  a working retry, not an empty page behind a toast that auto-dismisses.
