/** Runnable self-check for the boilerplate trimmer:  npm run check
 *  Node 22.6+ strips the types itself — no test framework, no build step.
 *
 *  What matters here is the asymmetry of the risk. Failing to trim a benefits
 *  section costs a little of the character budget. Trimming a *requirements*
 *  section costs the user a tailored resume built from half a posting, and
 *  they would have no way to know. So the assertions below are weighted
 *  heavily toward "never removes the wrong thing" — several of them exist only
 *  to prove the trimmer keeps its hands off ordinary prose.
 */

import { trimBoilerplate } from "./jdTrim.ts";

let failed = 0;
function ok(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

const POSTING = `Senior Backend Engineer

About the role
You will own the settlement pipeline end to end.

Requirements
- 5+ years of Python
- Experience with PostgreSQL
- Kafka or similar

Nice to have
- Kubernetes

Benefits
- 28 days holiday
- Private healthcare
- A generous learning budget

Equal Opportunity Employer
We are committed to building a diverse team and welcome applications from
everyone regardless of background.`;

function demo() {
  const trimmed = trimBoilerplate(POSTING);

  // 1. It removes what it should.
  ok(!trimmed.text.includes("28 days holiday"), "the benefits list should be gone");
  ok(!trimmed.text.includes("Private healthcare"), "the benefits list should be gone");
  ok(!trimmed.text.includes("regardless of background"), "the EEO paragraph should be gone");
  ok(trimmed.removed.includes("Benefits"), `should name what it removed, got ${trimmed.removed}`);
  ok(trimmed.saved > 100, `should report the saving, got ${trimmed.saved}`);

  // 2. And nothing else. This is the assertion that matters: a trimmer that
  //    eats the requirements is far worse than no trimmer.
  ok(trimmed.text.includes("5+ years of Python"), "requirements must survive");
  ok(trimmed.text.includes("PostgreSQL"), "requirements must survive");
  ok(trimmed.text.includes("Kafka or similar"), "requirements must survive");
  ok(trimmed.text.includes("Kubernetes"), "the nice-to-have section must survive");
  ok(trimmed.text.includes("settlement pipeline"), "the role description must survive");
  ok(trimmed.text.includes("Senior Backend Engineer"), "the title must survive");

  // 3. A boilerplate heading in the middle must not swallow the rest of the
  //    posting — the section ends at the next heading.
  const middle = trimBoilerplate(
    "Benefits\n- Holiday\n\nRequirements\n- Python\n- SQL\n\nAbout us\nWe are a company."
  );
  ok(middle.text.includes("- Python"), "a mid-document benefits block must not eat what follows");
  ok(middle.text.includes("- SQL"), "a mid-document benefits block must not eat what follows");
  ok(!middle.text.includes("- Holiday"), "the benefits list itself should still go");
  ok(!middle.text.includes("We are a company"), "the about section should still go");

  // 4. Prose that merely mentions a keyword is not a heading.
  const prose =
    "We think benefits matter and our benefits package is genuinely good, which is why " +
    "our benefits are listed on the careers page rather than buried in a posting.";
  ok(trimBoilerplate(prose).text === prose, "a sentence mentioning benefits must be untouched");
  ok(trimBoilerplate(prose).removed.length === 0, "and must not be reported as removed");

  // 5. A posting with no boilerplate comes back unchanged, and says so.
  const clean = "Requirements\n- Python\n- SQL";
  const untouched = trimBoilerplate(clean);
  ok(untouched.text === clean, "a clean posting must be returned verbatim");
  ok(untouched.saved === 0 && untouched.removed.length === 0, "and must report no change");

  // 6. Bullets are never mistaken for headings, even short ones.
  const bullets = "Requirements\n- Python\n- SQL\n- Go";
  ok(trimBoilerplate(bullets).text === bullets, "bullets must not be treated as headings");

  // 7. Degenerate input does not throw.
  ok(trimBoilerplate("").text === "", "empty input is fine");
  ok(trimBoilerplate("\n\n\n").text === "", "whitespace-only input collapses to empty");

  if (failed) {
    console.error(`jdTrim: ${failed} assertion(s) failed`);
    process.exitCode = 1;
  } else {
    console.log(
      "jdTrim: removes benefits/EEO/about sections, keeps every requirement, and leaves prose alone"
    );
  }
}

demo();
