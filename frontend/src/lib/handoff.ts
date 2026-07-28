/** Handoff from a job posting into the tailoring form.
 *  sessionStorage, not a query string: a job description is far too big for a
 *  URL, and it shouldn't outlive the tab. */
export const TAILOR_HANDOFF_KEY = "facet:tailor-job";

export interface TailorHandoff {
  company: string;
  role_title: string;
  job_description: string;
  job_url: string;
}

export function readHandoff(): TailorHandoff | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(TAILOR_HANDOFF_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(TAILOR_HANDOFF_KEY); // one-shot: a reload starts clean
  try {
    return JSON.parse(raw) as TailorHandoff;
  } catch {
    return null;
  }
}
