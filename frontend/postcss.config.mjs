/** @type {import('postcss-load-config').Config} */
// Tailwind 4 moved the PostCSS plugin into its own package — a bare
// `tailwindcss: {}` here is v3 syntax and throws under v4.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
