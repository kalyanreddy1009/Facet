import type { Config } from "tailwindcss";

/** Every value resolves to a CSS variable defined in globals.css — one place
 *  a colour, radius or duration is ever defined. */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: {
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
          4: "var(--surface-4)",
        },
        text: {
          DEFAULT: "var(--text)",
          dim: "var(--text-dim)",
          muted: "var(--text-muted)",
          faint: "var(--text-faint)",
          ghost: "var(--text-ghost)",
        },
        border: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
          control: "var(--border-control)",
        },
        accent: {
          // `DEFAULT` is the fill, `text` is the ink. They are the same hue at
          // two lightnesses because no single one clears AA in both roles.
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          text: "var(--accent-text)",
          soft: "var(--accent-soft)",
          border: "var(--accent-border)",
        },
        /** The label on an accent fill. A literal `text-white` for this was
         *  the one colour in the app that could not follow the token — which
         *  is exactly the kind of thing that survives a theme change and
         *  becomes an invisible label. */
        "on-accent": "var(--on-accent)",
        ok: {
          DEFAULT: "var(--ok)",
          text: "var(--ok-text)",
          soft: "var(--ok-soft)",
          border: "var(--ok-border)",
        },
        warn: {
          DEFAULT: "var(--warn)",
          text: "var(--warn-text)",
          soft: "var(--warn-soft)",
          border: "var(--warn-border)",
        },
        danger: {
          DEFAULT: "var(--danger)",
          text: "var(--danger-text)",
          soft: "var(--danger-soft)",
          border: "var(--danger-border)",
        },
        // Decoration only — the ambient field and the hero. Never a control.
        glint: "var(--glint)",
        neutral: {
          DEFAULT: "var(--neutral)",
          soft: "var(--neutral-soft)",
          border: "var(--neutral-border)",
        },
        overlay: "var(--overlay)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "Menlo", "monospace"],
      },
      fontSize: {
        // Tight product scale. Hierarchy is weight and size, never decoration.
        //
        // In `rem`, not `px`, and that is an accessibility requirement rather
        // than a style preference. This scale is where every `text-*` in the
        // app resolves, so when it was in px the entire interface ignored the
        // reader's browser font-size setting: at a 32px root — the 200%
        // enlargement Apple's HIG asks every interface to survive — body copy
        // measured 14px, buttons 13px and captions 11.5px, exactly as they do
        // at 100%. Nothing moved. One px scale in one config file quietly
        // opted the whole product out of Dynamic Type.
        //
        // The values below are the same sizes divided by a 16px root, so at
        // the default setting every screen renders to the identical pixel.
        "2xs": ["0.6875rem", { lineHeight: "1.35" }], // 11px
        xs: ["0.75rem", { lineHeight: "1.4" }], // 12px
        sm: ["0.8125rem", { lineHeight: "1.5" }], // 13px
        base: ["0.875rem", { lineHeight: "1.55" }], // 14px
        md: ["0.9375rem", { lineHeight: "1.55" }], // 15px
        lg: ["1.0625rem", { lineHeight: "1.45", letterSpacing: "-0.008em" }], // 17px
        xl: ["1.25rem", { lineHeight: "1.35", letterSpacing: "-0.012em" }], // 20px
        "2xl": ["1.5rem", { lineHeight: "1.3", letterSpacing: "-0.016em" }], // 24px
        "3xl": ["1.875rem", { lineHeight: "1.22", letterSpacing: "-0.02em" }], // 30px
        "4xl": ["2.375rem", { lineHeight: "1.15", letterSpacing: "-0.024em" }], // 38px
        // The landing page only — the one page where expressiveness is
        // earned. Leading under 1 is the whole point; it only reads at this
        // size, and the size is the reason the page has any presence at all.
        hero: ["clamp(3.25rem,8.5vw,6.5rem)", { lineHeight: "0.92", letterSpacing: "-0.036em" }],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      transitionTimingFunction: {
        DEFAULT: "var(--ease)",
        out: "var(--ease-out)",
        emph: "var(--ease-emph)",
        exit: "var(--ease-exit)",
      },
      transitionDuration: {
        fast: "120ms",
        DEFAULT: "200ms",
        slow: "320ms",
        slower: "520ms",
      },
      boxShadow: {
        // Neutral black only. A coloured shadow is the fastest way to look fake.
        popover: "0 8px 24px rgba(19,24,36,0.14)",
        raised: "var(--shadow-raised)",
        float: "var(--shadow-float)",
      },
      maxWidth: {
        /** The one content measure. The nav island and every page's <main>
         *  share it, so on a wide display the interface has a single left and
         *  right edge instead of five — 1320 for the nav, 896 for the Cabinet,
         *  1024 for Admin and 768 for Profile is what read as "the layout
         *  falls apart on a big monitor". Narrower than the old 1320 on
         *  purpose: past this, a row of cards stops being scannable. */
        shell: "1120px",
        prose: "66ch",
      },
      spacing: {
        /** The island itself. */
        nav: "var(--nav-h)",
        /** The vertical space the floating nav occupies, inset included. What
         *  anything positioning itself below the nav actually needs. */
        "nav-block": "var(--nav-block)",
      },
    },
  },
  plugins: [],
};
export default config;
