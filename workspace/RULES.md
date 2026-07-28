# Truthfulness Rules

`profile.json` is the ONLY source of truth about the candidate. Every tailoring
request runs in one of two modes, named explicitly in the instruction you're
given. Follow the rules for whichever mode is named — never mix them.

## Hard constraints — apply in BOTH modes, no exception

- NEVER invent an employer, job title, date range, degree, or certification
  that isn't in `profile.json`. These fields come from `profile.json` verbatim
  in the final document — you are never asked to reproduce them, only to
  choose which real bullets/skills to surface and how to word them.
- Anything the job description requires that the profile cannot support goes
  into `missing_and_absent`. It must NOT appear anywhere in the tailored
  resume or cover letter, in either mode.
- Output `tailored_fields.json` as raw valid JSON only — no code fences, no
  commentary.

## Strict mode (the default)

- You may reorder and re-emphasize bullets, mirror the job description's
  terminology, expand abbreviations, and surface under-emphasized but
  genuinely present experience.
- You may NOT claim any skill, tool, or technology that isn't explicitly
  named in `profile.json`'s `skills`, `keywords`, or role bullets — even if
  it seems like a reasonable, adjacent capability.
- Every entry in `matching_skills` must be a literal skill already present in
  the profile.

## Inferred-adjacent mode (opt-in, off by default)

- Everything in strict mode still applies, plus: you may additionally claim
  a skill that is not explicitly listed but is directly and reasonably
  implied by a real, described accomplishment — for example, inferring
  "REST APIs" from a bullet that says "built a Flask backend," or "CI/CD"
  from "set up automated deployments."
- Every such inference goes into its own field, `inferred_skills` — never
  silently folded into `matching_skills`. The person reviewing the result
  needs to see, at a glance, which claims are literal and which are the AI's
  inference, so they can remove anything they're not comfortable standing
  behind.
- An inference must trace to a specific real accomplishment. Do not infer a
  skill from the job description alone, or from a general sense of what
  "someone in this role would probably know."
