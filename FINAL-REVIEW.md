# Final review — 24 improvement tasks

The last pass over Facet's interface before the next phase. Every task below
follows the same four steps: **analyse**, **verify it cannot break anything**,
**implement**, **test**. Nothing here changes what the application does — no
endpoint, no schema, no product boundary. Both issues called out in the brief
are tasks 1 and 2.

Validation ran against a real Chromium, driving an isolated sandbox
(`FACET_DATA_DIR`/`FACET_WORKSPACE_DIR` on :8100, frontend on :3100) — never
the live database. Two harnesses came out of it and stay in the repo:
`frontend/scripts/check-layout.mjs` (geometry at six widths) and a new rule in
`check-interface.mjs`.

---

## 1. The Change Password button rendered as a hyperlink

- **Analyse.** `<span className="btn-cap">Change password</span>` — the label
  was inside the cap. `.btn-cap` is a fixed 20px disc with a white fill and
  accent-coloured text, so the label was clipped to a circle and the accent
  text spilled out of it. It reads as a link on a dot at every width; it only
  *looked* size-dependent because the surrounding form is wider on a desktop.
  The identical bug shipped once before as "the white dot in the Sign In
  button".
- **Verify.** Presentation only — the button keeps its `type="submit"`, its
  `disabled` binding and its handler.
- **Implement.** Label in the button, arrow icon in the cap, spinner +
  "Changing…" while busy, `aria-busy` while in flight.
- **Test.** Measured in Chromium at 2560/1920/1440/834/390: a 163×32 button
  with the accent gradient, white label, 9px radius, empty cap — identical at
  every width. Screenshot verified.

## 2. The layout fell apart on large displays

- **Analyse.** Five different page widths (`max-w-shell` 1320, `4xl` 896, `5xl`
  1024, `3xl` 768, `md` 448) against a nav capped at 1320. On a wide monitor
  the nav, the Rough, the Cabinet and Profile each started at a different
  vertical line. The nav was also capped at the *page* measure while pages cap
  then pad, so even matched numbers left a 32px disagreement.
- **Verify.** Container widths only; no component's internals moved.
- **Implement.** One measure (`shell: 1120px`) for every page; the nav gutter
  now matches the page gutter (20/32px) and the island is capped at the
  *content* measure (`1120 − 64`). Profile became a two-column grid past `lg`
  so its cards stop being 1100px bands around a 380px form; Tailor keeps a
  reading column inside the shared frame.
- **Test.** `check-layout.mjs` at 2560/1920/1440/1024/834/390 across eight
  routes: nav and content boxes now agree to the pixel, no horizontal
  overflow, no page errors. Confirmed again against production.

## 3. Every browser tab was called "Facet"

- **Analyse.** All seven screens are client components, which cannot export
  Next's `metadata`; three tabs of Facet were indistinguishable. A client-side
  `document.title` effect was tried first and lost to Next's own metadata
  render — measured, not assumed.
- **Verify.** Each route became a three-line server file rendering the
  unchanged client component. No hooks, state or props moved.
- **Implement.** `app/*/page.tsx` (server, `metadata`) + `PageClient.tsx`
  (unchanged screen), with a `%s · Facet` template in the layout.
- **Test.** Live: "The Rough · Facet", "Cut a facet · Facet", "Sign in ·
  Facet", and the landing page keeps its absolute title.

## 4. The skip link did not move focus

- **Analyse.** `#main` was a plain `<div>`; an anchor to a non-focusable
  element scrolls but leaves focus behind, so the next Tab went back into the
  nav — the link looked right and did nothing for the one person who needs it.
- **Verify.** `tabIndex={-1}` adds no tab stop; kept as a `div` because every
  page renders its own `<main>`.
- **Implement.** `tabIndex={-1}` + `outline-none` on the target.
- **Test.** Tab → Enter in Chromium: `document.activeElement.id === "main"`.

## 5. Account menu lost focus on Escape

- **Analyse.** Escape closed the popover and dropped focus to `<body>`; the
  next Tab restarted from the top of the document.
- **Verify.** Added a ref and one `focus()` call; open/close logic untouched.
- **Implement.** Focus returns to the trigger.
- **Test.** Keyboard walk-through; menu still closes on outside click.

## 6. The mobile menu had no way out but the button

- **Analyse.** No Escape handler, and rotating a phone into the desktop layout
  left the sheet mounted over a nav already showing the same links.
- **Verify.** Effect only runs while the menu is open and cleans up after
  itself.
- **Implement.** Escape closes it; a `min-width: 768px` media-query listener
  closes it on the breakpoint crossing.
- **Test.** Automated: open → Escape → the `Main` navigation is gone.

## 7. Postings without a URL rendered as dead links

- **Analyse.** `href={job.posting_url || undefined}` still emits an `<a>`: no
  tab stop, and a screen reader announces a link that goes nowhere.
- **Verify.** The `onOpen` bookkeeping call only ever mattered when a URL
  existed.
- **Implement.** Title falls back to plain text; the real link gains a
  `title` and an `sr-only` "(opens in a new tab)".
- **Test.** Rendered both shapes; `check-interface` still passes the
  `rel="noreferrer"` rule.

## 8. Job cards kept stale scores after a sync

- **Analyse.** The memo comparator watched `id` and `promoted` only, so a
  re-scored row kept its old percentage and matching terms while the sort
  order used the new ones.
- **Verify.** The comparator only ever got *more* permissive to re-render;
  `match_terms` compared by identity so a fresh array from the API still
  triggers one render, not a deep walk.
- **Implement.** Compare every field the card draws.
- **Test.** Rough list at 514 postings; no re-render storm, scroll still
  smooth under the infinite-scroll observer.

## 9. Copy buttons could fail silently

- **Analyse.** `copyText` already refuses to claim a success it did not have,
  but both call sites `return`ed on failure — a denied clipboard produced a
  button that did nothing at all when clicked.
- **Verify.** One shared component replacing two near-identical local ones;
  same class names, same placement.
- **Implement.** `components/ui/CopyButton.tsx` with idle / copied / failed,
  the failed state naming the keyboard shortcut, `aria-live="polite"`.
- **Test.** Both call sites render and copy; the four clipboard assertions in
  `npm run check` still pass.

## 10. ⌘S in the Stone editor saved the web page

- **Analyse.** The Stone is a full-screen text editor holding the document the
  entire product is built from, and the universal save shortcut fell through
  to the browser.
- **Verify.** Inert unless the document is dirty, non-empty and not already
  saving — the same conditions that enable the Save button.
- **Implement.** Window-level ⌘/Ctrl+S, routed through a ref so a 30KB
  textarea does not re-bind a listener per keystroke. Button tooltip says so.
- **Test.** Automated: type → Ctrl+S → the save lands and the button reads
  "Saved".

## 11. Extraction polling rebuilt its timer every tick

- **Analyse.** The effect depended on the `extraction` object it set every
  1.5s, so it tore down and recreated its interval on each poll; the clock
  restarted rather than running at a fixed cadence, and a backgrounded tab
  kept asking.
- **Verify.** Keyed on the status string; the same states start and stop it.
- **Implement.** `extractionStatus` dependency + a `document.hidden` guard.
- **Test.** Saved a stone in the sandbox and watched the poll run to
  completion; a hidden tab issues no requests.

## 12. `setInterval` was shadowed on the Status page

- **Analyse.** `const [interval, setInterval] = useState(...)` shadowed the
  global for the whole module. Any timer added to that file would have called
  a state setter instead — and would have looked like "the page stopped
  refreshing", not like a name collision.
- **Verify.** Pure rename, three call sites.
- **Implement.** `refreshMs` / `setRefreshMs`.
- **Test.** Auto-refresh still switches between Off/5s/15s/60s and the report
  updates.

## 13. Undo disappeared before you could reach it

- **Analyse.** A 3.5s toast carrying the only Undo for a dismissed posting is
  a promise the app cannot keep — deciding and reaching for the mouse takes
  longer than that. Timers also survived unmount and fired into a dead
  component.
- **Verify.** Pause/resume are optional props; a caller that ignores them
  behaves exactly as before.
- **Implement.** `hold`/`resume` in `useToasts`, wired to pointer and focus on
  the Toaster; all timers cleared on unmount.
- **Test.** Automated: hover held a toast for 4.5s past its 3.5s life, and it
  dismissed 4s after the pointer left.

## 14. The Cabinet's tab was not linkable

- **Analyse.** The open view lived in component state, so a reload or a shared
  link always landed on Applications.
- **Verify.** Hash read in an effect (a server render has no fragment);
  `replaceState`, so switching tabs does not fill the Back button.
- **Implement.** `/cabinet#facets`, `#interviews`, and a clean URL for the
  default.
- **Test.** Automated: deep link opens Interviews, switching writes the hash,
  reload restores it, the default clears it.

## 15. A pasted job description could be lost with no undo

- **Analyse.** Pasting a full posting is the most tedious thing the app asks
  for, and one mis-click on the nav discarded it — no undo, nothing in the
  Back button.
- **Verify.** `sessionStorage` (this tab, this sitting — a shared machine will
  not find someone's job hunt tomorrow); a handoff from the Rough still wins,
  and the draft clears itself when the fields are empty. Every access is
  wrapped, so private mode cannot throw into a render.
- **Implement.** Draft restore/save in `TailorForm`.
- **Test.** Automated: fill → navigate away → return; company and description
  both restored.

## 16. The description cap truncated a paste in silence

- **Analyse.** `slice(0, 15000)` dropped the end of a long posting — usually
  the requirements — with a counter nobody was watching as the only evidence.
- **Verify.** The cap itself is unchanged; this only reports it.
- **Implement.** A message naming what to trim, the counter turning red at the
  cap, `aria-describedby` on the textarea.
- **Test.** Pasted 20,000 characters; the warning appears and the counter
  pins.

## 17. Raw HTML was printed on the job cards

- **Analyse.** Several feeds store descriptions as HTML, and the Rough
  rendered it as text: cards began `<p>At Scale AI, our mission…` and
  `<div class="content-intro"><h2><span style=…`. The same string was handed
  to the tailoring model as the job description.
- **Verify.** `plainText()` produces a string that is still rendered as text —
  nothing is inserted as HTML, so it cannot become an injection.
- **Implement.** `plainText` in `lib/format.ts` (tags out, entities decoded,
  whitespace collapsed), used on the card and on the Tailor handoff.
- **Test.** Six assertions in the existing `format.check.ts` self-check
  (including `<script>` contents dropped whole); measured on the live feed —
  no markup in any summary on screen.

## 18. Filter names were cut off with no way to read them

- **Analyse.** Several source names are longer than the 240px rail and
  truncated to "We Work Remotely — DevOps & S" with no tooltip.
- **Verify.** A `title` attribute; no layout change.
- **Implement.** Full name on hover for both the radio rows and the source
  checkboxes.
- **Test.** Rough at 1440 and 1024.

## 19. `text-white` was the one colour outside the token system

- **Analyse.** The Segmented control's active label and the filter checkmark
  were literal white — the exact kind of value that survives a theme change and
  becomes invisible.
- **Verify.** `--on-accent` is `#ffffff` today, so this is a no-op render with
  a real change in intent.
- **Implement.** `on-accent` colour token; both call sites use it.
- **Test.** Cabinet tabs and filter checkboxes unchanged on screen.

## 20. Reduced-transparency made toasts unreadable

- **Analyse.** `prefers-reduced-transparency` painted `.chrome` with
  `--surface-1` — white — but `.chrome` scopes `--text` to near-white for the
  dark instrument material. Every toast and the loading overlay became white
  type on white, for the one group of people who asked for *more* legibility.
  The landing page's `.glass-card` had also been added after that block and
  kept its translucency straight through the preference.
- **Verify.** Scoped entirely to the media query; the default rendering does
  not change.
- **Implement.** `.chrome` keeps its graphite and only loses the blur;
  `.glass-card` goes opaque.
- **Test.** Emulated the preference in Chromium — toast and overlay legible.

## 21. The Cabinet's loading state was silent

- **Analyse.** Two grey rectangles announce nothing; a screen reader was told
  neither that the page was loading nor when it finished.
- **Verify.** `role="status"` + label on the wrapper; no visual change.
- **Implement.** Announced skeleton.
- **Test.** Accessibility tree inspected in Chromium.

## 22. The hero illustration was hidden on every phone and tablet

- **Analyse.** `hidden lg:grid` — the animated stone is the centre of the
  landing page's aesthetics, and most of the traffic a landing page sees never
  saw it.
- **Verify.** Sized with `clamp()` so it cannot push the primary action below
  the fold; a phone in portrait still skips it.
- **Implement.** Visible from `sm` up.
- **Test.** Captured at 834 and 1024; hero and buttons both above the fold, no
  overflow.

## 23. The copy claimed a single-user product

- **Analyse.** "Your record, your machine", "Runs entirely on your machine",
  "written to master_resume.md on this machine", "your local database" — all
  true of the original local checkout, none true of the multi-user deployment
  people actually read them on. The FAQ two screens down already said the
  opposite.
- **Verify.** Copy only.
- **Implement.** The promise that actually holds — isolation between accounts —
  in the badge, the meta description, the Stone footnote and the Cabinet's
  error state.
- **Test.** Read in place at 1920 and 390.

## 24. Two segmented controls marked "current" differently

- **Analyse.** The Cabinet's tabs used the accent key; the Status page's
  auto-refresh control used a grey fill. Same shape, same job, two answers.
- **Verify.** Class swap; the roving-focus `radiogroup` roles are untouched.
- **Implement.** The shared `seg-active` treatment on both.
- **Test.** Status page at 1920; keyboard selection still works.

---

## Guardrails added

- **`check-interface.mjs`** gained a rule for text inside `.btn-cap` — the
  regression in task 1, which had already shipped twice. Verified by feeding it
  the old markup: it fails with the exact message.
- **`check-layout.mjs`** is new: it drives Chromium over eight routes at six
  widths and fails on horizontal overflow, on a nav/content edge disagreement,
  or on an uncaught page error. This is what caught the residual 32px in
  task 2 — no static check could have.

## Verification run

```
npm run check      format · api cache · clipboard · design system · interface  ✓
npx tsc --noEmit                                                               ✓
npx eslint src                                            0 errors, 11 warnings (pre-existing)
backend/scripts/check_all.py                                                   ✓
node scripts/check-layout.mjs        6 widths × 8 routes — no overflow, no misalignment
interaction suite                    13/13 (deep links, drafts, ⌘S, toasts, Escape, skip link)
deploy/publish.sh                    built into .next.incoming, swapped, restarted — public: 200
```

## Deliberately left alone

- The `gradient-text` design-hook finding on `.wordmark` is the brand's
  breathing animation, signed off in the previous sprint. Unchanged.
- Eleven ESLint `react-hooks` warnings predate this pass and every one is a
  deliberate `setState`-in-effect for a data fetch. Changing them is a
  behaviour change, which this review is not for.
