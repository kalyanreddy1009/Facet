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
        "2xs": ["11px", { lineHeight: "1.35" }],
        xs: ["12px", { lineHeight: "1.4" }],
        sm: ["13px", { lineHeight: "1.5" }],
        base: ["14px", { lineHeight: "1.55" }],
        md: ["15px", { lineHeight: "1.55" }],
        lg: ["17px", { lineHeight: "1.45", letterSpacing: "-0.008em" }],
        xl: ["20px", { lineHeight: "1.35", letterSpacing: "-0.012em" }],
        "2xl": ["24px", { lineHeight: "1.3", letterSpacing: "-0.016em" }],
        "3xl": ["30px", { lineHeight: "1.22", letterSpacing: "-0.02em" }],
        "4xl": ["38px", { lineHeight: "1.15", letterSpacing: "-0.024em" }],
        // `/welcome` only — the one page where expressiveness is earned.
        // Leading under 1 is the whole point; it only reads at this size.
        hero: ["clamp(2.75rem,7vw,5rem)", { lineHeight: "0.95", letterSpacing: "-0.032em" }],
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
        popover: "0 8px 24px rgba(0,0,0,0.5)",
        raised: "var(--shadow-raised)",
        float: "var(--shadow-float)",
      },
      maxWidth: {
        shell: "1320px",
        prose: "66ch",
      },
      spacing: {
        nav: "var(--nav-h)",
      },
    },
  },
  plugins: [],
};
export default config;
