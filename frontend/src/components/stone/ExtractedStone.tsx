"use client";

/**
 * What Facet actually thinks you are.
 *
 * Until now there was no screen in the product that showed this. You wrote
 * markdown into an editor, an extraction ran in the background, and a
 * `profile.json` you never saw became the ceiling on every claim in every
 * application you sent. The page promising "the permanent, honest record of
 * your background" showed you a text box.
 *
 * That is the wrong shape for this app in particular. Facet's whole argument
 * is that it cannot invent anything, because everything is bounded by your
 * Stone. An argument like that is only worth as much as your ability to check
 * it — and you cannot check a file you have never been shown.
 *
 * So this is the Stone, read back. Not editable: the markdown above is the
 * source and this is what was understood from it, and two editable copies of
 * one truth is how they drift. If something here is wrong, the fix is upstairs.
 *
 * It also closes a real hole. A workspace can hold a populated profile.json
 * with no master_resume.md — restored from a backup, migrated between hosts,
 * or the markdown simply deleted. The page then rendered an empty editor and
 * looked, to the person whose record it is, exactly like data loss.
 */

import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import Panel from "@/components/ui/Panel";
import { formatRoleDate } from "@/lib/format";

interface Role {
  id?: string;
  company?: string;
  title?: string;
  start?: string;
  end?: string;
  location?: string;
  bullets?: string[];
}

interface Profile {
  name?: string;
  contact?: { email?: string; phone?: string; location?: string; linkedin?: string };
  summary_base?: string;
  skills?: string[];
  keywords?: string[];
  roles?: Role[];
  projects?: { name?: string; stack?: string; description?: string }[];
  education?: { degree?: string; institution?: string; year?: string }[];
  certifications?: ({ name?: string; year?: string } | string)[];
}

/** A labelled block with a hairline above it. Same grammar as the landing
 *  page's vocabulary rows — reference material, scannable in one pass. */
function Section({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="ruled-row py-3.5">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="label">{label}</p>
        {count !== undefined && <span className="mono text-2xs text-text-ghost tnum">{count}</span>}
      </div>
      {children}
    </div>
  );
}

export default function ExtractedStone() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "none" | "error">("loading");

  useEffect(() => {
    let live = true;
    fetch("/api/profile", { credentials: "include" })
      .then(async (response) => {
        if (!live) return;
        // 404 is not an error here: it is a person who has not imported yet,
        // which is a completely ordinary state and gets its own words.
        if (response.status === 404) return setState("none");
        if (!response.ok) throw new Error(String(response.status));
        setProfile(await response.json());
        setState("ready");
      })
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, []);

  if (state === "loading") {
    return (
      <Panel className="mt-4 p-5">
        <p className="flex items-center gap-2 text-sm text-text-faint">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          Reading your Stone…
        </p>
      </Panel>
    );
  }

  if (state === "error") {
    return (
      <Panel className="mt-4 p-5">
        <p className="flex items-center gap-2 text-sm text-text-dim">
          <AlertCircle className="w-4 h-4 text-warn-text shrink-0" aria-hidden />
          Could not read your Stone. The markdown above is unaffected - it is the
          source, and this panel is only what was understood from it.
        </p>
      </Panel>
    );
  }

  if (state === "none" || !profile) {
    return (
      <Panel className="mt-4 p-5 flex flex-col gap-2">
        <p className="text-sm text-text">Nothing extracted yet.</p>
        <p className="text-sm text-text-dim max-w-prose text-pretty">
          Import a resume or write one above, then save. Facet reads it in the background and
          what it understood appears here - every fact it is allowed to use, and nothing else.
        </p>
      </Panel>
    );
  }

  const roles = profile.roles ?? [];
  const skills = profile.skills ?? [];
  const contact = profile.contact ?? {};
  const contactLine = [contact.email, contact.phone, contact.location, contact.linkedin]
    .filter(Boolean)
    .join(" · ");

  return (
    <Panel className="mt-4 p-5">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="text-base font-semibold text-text">What Facet understood</h2>
        <span className="mono text-2xs text-text-ghost">profile.json</span>
      </div>
      <p className="text-xs text-text-faint max-w-prose text-pretty mb-3">
        The ceiling on every application. Nothing Facet writes can go beyond what is on this
        list. Read-only - the markdown above is the source, and editing two copies of one truth
        is how they drift apart.
      </p>

      <div className="border-t border-border">
        {(profile.name || contactLine) && (
          <Section label="Identity">
            {profile.name && <p className="text-sm font-medium text-text">{profile.name}</p>}
            {contactLine && <p className="text-xs text-text-dim mt-0.5">{contactLine}</p>}
          </Section>
        )}

        {profile.summary_base && (
          <Section label="Summary">
            <p className="text-sm text-text-dim leading-relaxed text-pretty">
              {profile.summary_base}
            </p>
          </Section>
        )}

        {skills.length > 0 && (
          <Section label="Skills" count={skills.length}>
            {/* Plain middot-separated text, not pills. These are the terms the
                tailor may reorder and re-emphasise; a wall of chips would read
                as decoration and out-shout the roles, which matter more. */}
            <p className="text-sm text-text-dim leading-relaxed">{skills.join(" · ")}</p>
          </Section>
        )}

        {roles.length > 0 && (
          <Section label="Roles" count={roles.length}>
            <div className="flex flex-col gap-3">
              {roles.map((role, i) => (
                <div key={role.id ?? i}>
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <span className="text-sm font-medium text-text">{role.title}</span>
                    <span className="mono text-2xs text-text-faint">
                      {formatRoleDate(role.start)} – {formatRoleDate(role.end)}
                    </span>
                  </div>
                  <p className="text-xs text-text-dim mt-0.5">
                    {role.company}
                    {role.location ? ` · ${role.location}` : ""}
                  </p>
                  {/* The bullet count, not the bullets. These are what the
                      tailor rewrites per posting, so what matters here is that
                      the role has material to work from — a role showing 0 is
                      the actionable signal, and it is easy to miss in prose. */}
                  <p className="text-2xs text-text-ghost mt-1 tnum">
                    {role.bullets?.length ?? 0} bullet
                    {(role.bullets?.length ?? 0) === 1 ? "" : "s"}
                    {(role.bullets?.length ?? 0) === 0 && (
                      <span className="text-warn-text"> - nothing for the tailor to draw on</span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {(profile.education ?? []).length > 0 && (
          <Section label="Education" count={profile.education?.length}>
            <div className="flex flex-col gap-1.5">
              {profile.education?.map((entry, i) => (
                <div key={i} className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-text-dim">{entry.degree}</span>
                  <span className="mono text-2xs text-text-faint">{formatRoleDate(entry.year)}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {(profile.certifications ?? []).length > 0 && (
          <Section label="Certifications" count={profile.certifications?.length}>
            <p className="text-sm text-text-dim">
              {profile.certifications
                ?.map((cert) => (typeof cert === "string" ? cert : cert.name))
                .filter(Boolean)
                .join(" · ")}
            </p>
          </Section>
        )}
      </div>
    </Panel>
  );
}
