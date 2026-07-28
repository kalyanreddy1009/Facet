/** Runnable self-check for the formatting helpers:  npm run check
 *  Node 22.6+ strips the types itself — no test framework, no build step. */
import { demo } from "./format.ts";

demo();
