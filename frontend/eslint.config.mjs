// ESLint 9 flat config. Replaces `.eslintrc.json` — ESLint 9 dropped the
// eslintrc format, and Next 16 removed the `next lint` wrapper, so the `lint`
// script now calls eslint directly.
//
// NOT ESLint 10, deliberately: `eslint-config-next@16` bundles an
// `eslint-plugin-react` that still calls `context.getFilename()`, which ESLint
// 10 removed. Its peer range claims `>=9`, but 10 throws on every file. Move
// to 10 once that plugin ships the fix.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // New in eslint-config-next 16, and stricter than the code it now judges.
      // All six current hits are legitimate external-system syncs — fetch on
      // mount, prefill from sessionStorage, read a matchMedia result — which
      // React's own guidance permits. None causes the cascading renders the
      // rule warns about: INP measures 40 ms and the console is clean.
      // Downgraded to a warning rather than mass-refactoring every data-fetch
      // path during a dependency upgrade. Worth revisiting deliberately, on
      // its own, with the React Compiler.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default config;
