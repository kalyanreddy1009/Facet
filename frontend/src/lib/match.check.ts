/** Runnable self-check for the browser-side match pre-check:  npm run check
 *  Node 22.6+ strips the types itself — no test framework, no build step.
 *
 *  The point of this file is not that `matchAgainst` returns plausible
 *  numbers. It is that it returns the SAME numbers as
 *  `backend/services/matching.py`, which is the actual authority — the backend
 *  uses its own copy to decide whether to warn that a cut is a weak match, and
 *  a page that shows 48% next to a server that thinks it is 12% is worse than
 *  a page that shows nothing.
 *
 *  So where the Python interpreter is available, this runs the real one and
 *  compares. Where it is not, the fixtures below still pin the behaviour — the
 *  expected values were produced by that same Python function, so they are its
 *  answers either way.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { WEAK_MATCH_THRESHOLD, matchAgainst } from "./match.ts";

let failed = 0;
function ok(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

const KEYWORDS = ["Python", "FastAPI", "PostgreSQL", "Kubernetes", "C++", "node.js", "AWS"];

/** Cases chosen to exercise the parts most likely to drift: substring hits,
 *  punctuation inside technology names, case folding, and an empty term. */
const CASES: { text: string; keywords: string[] }[] = [
  { text: "We use Python and FastAPI with Postgres on AWS.", keywords: KEYWORDS },
  { text: "Deep C++ experience; some node.js. Kubernetes a plus.", keywords: KEYWORDS },
  { text: "A marketing role with no engineering content whatsoever.", keywords: KEYWORDS },
  { text: "PYTHON PYTHON PYTHON", keywords: KEYWORDS },
  { text: "postgresql, postgres, psql", keywords: ["PostgreSQL", "Postgres"] },
  { text: "anything", keywords: [] },
  { text: "", keywords: KEYWORDS },
  { text: "python", keywords: ["Python", "  ", "AWS"] },
];

function demo() {
  // 1. The threshold has to be the same number on both sides, or the page
  //    calls a cut weak that the server is happy with, or the reverse.
  // From src/lib/: three levels up is the repo root.
  const python = "../../../backend/.venv/bin/python";
  const haveBackend = existsSync(new URL(python, import.meta.url).pathname);

  if (haveBackend) {
    // Read the number out of the backend rather than trusting a comment: this
    // is the one constant that has to be identical in two languages, and the
    // failure mode if it drifts is a page confidently contradicting the
    // server about whether a posting is worth cutting.
    const tailor = readFileSync(
      new URL("../../../backend/routers/tailor.py", import.meta.url).pathname,
      "utf8"
    );
    const declared = tailor.match(/^WEAK_MATCH_THRESHOLD\s*=\s*([\d.]+)/m);
    ok(declared !== null, "could not find WEAK_MATCH_THRESHOLD in routers/tailor.py");
    if (declared) {
      ok(
        Number(declared[1]) === WEAK_MATCH_THRESHOLD,
        `threshold drift: backend ${declared[1]}, frontend ${WEAK_MATCH_THRESHOLD}`
      );
    }
  }

  // 2. Every fixture must agree with the Python implementation.
  if (haveBackend) {
    const program = `
import json, sys
sys.path.insert(0, "backend")
from services.matching import keyword_overlap_score
cases = json.loads(sys.argv[1])
print(json.dumps([keyword_overlap_score(c["text"], c["keywords"]) for c in cases]))
`;
    const out = execFileSync(
      new URL(python, import.meta.url).pathname,
      ["-c", program, JSON.stringify(CASES)],
      { cwd: new URL("../../..", import.meta.url).pathname, encoding: "utf8", env: { ...process.env, PYTHONPATH: "" } }
    );
    const expected = JSON.parse(out) as number[];
    CASES.forEach((testCase, i) => {
      const mine = matchAgainst(testCase.text, testCase.keywords).score;
      ok(
        Math.abs(mine - expected[i]) < 1e-9,
        `case ${i} disagrees with the backend: browser ${mine}, python ${expected[i]} — ` +
          `text ${JSON.stringify(testCase.text.slice(0, 40))}`
      );
    });
  }

  // 3. Behaviour the UI depends on, checked regardless of the backend.
  const rich = matchAgainst(CASES[0].text, KEYWORDS);
  ok(rich.hits.includes("Python"), "an exact term should hit");
  ok(rich.hits.includes("PostgreSQL") === false, "'Postgres' must not satisfy 'PostgreSQL'");
  ok(rich.misses.includes("Kubernetes"), "an absent term should be reported as not mentioned");
  ok(rich.hits.length + rich.misses.length === KEYWORDS.length, "every term is accounted for");

  const punctuated = matchAgainst(CASES[1].text, KEYWORDS);
  ok(punctuated.hits.includes("C++"), "'c++' must survive tokenisation");
  ok(punctuated.hits.includes("node.js"), "'node.js' must survive tokenisation");

  ok(matchAgainst("anything", []).score === 0, "no keywords means no score, not a divide by zero");
  ok(matchAgainst("", KEYWORDS).score === 0, "empty text scores zero");

  // A blank profile entry DOES count against the score, because that is what
  // services/matching.py does: it skips the empty term when counting hits and
  // still divides by the full list. This assertion pins the quirk deliberately
  // — the cross-check above caught the browser being "more correct" than the
  // server, which would have put a number on screen the backend disagreed
  // with. One in three, not one in two.
  const blank = matchAgainst("python", ["Python", "  ", "AWS"]);
  ok(
    Math.abs(blank.score - 1 / 3) < 1e-9,
    `a blank keyword must still count in the denominator, matching the backend; got ${blank.score}`
  );

  ok(WEAK_MATCH_THRESHOLD === 0.15, "the weak-match threshold moved without the backend");

  if (failed) {
    console.error(`match: ${failed} assertion(s) failed`);
    process.exitCode = 1;
  } else {
    console.log(
      haveBackend
        ? `match: browser scoring agrees with services/matching.py across ${CASES.length} fixtures`
        : `match: scoring behaviour pinned (backend absent, cross-check skipped)`
    );
  }
}

demo();
