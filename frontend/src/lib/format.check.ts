/** Runnable self-check for the formatting helpers:  npm run check
 *  Node 22.6+ strips the types itself — no test framework, no build step. */
import {
  formatRoleDate, demo } from "./format.ts";

demo();  // formatRoleDate must agree with resume_templates.when() on the backend —
  // the Stone panel shows the dates the rendered resume will carry, and the
  // two disagreeing about the user's own history is the failure to avoid.
  console.assert(formatRoleDate("2021-03") === "Mar 2021", "ISO month should normalise");
  console.assert(formatRoleDate("6/2018") === "Jun 2018", "slash form should normalise");
  console.assert(formatRoleDate("Present") === "Present", "unrecognised passes through");
  console.assert(formatRoleDate("Summer 2019") === "Summer 2019", "prose passes through");
  console.assert(formatRoleDate("2021-13") === "2021-13", "impossible month passes through");
  console.assert(formatRoleDate("") === "" && formatRoleDate(null) === "", "empty is empty");

  
