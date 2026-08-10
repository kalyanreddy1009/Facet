"use client";

/** v2 skin of `components/stone/ExtractedStone.tsx` — same read-only readback
 *  of profile.json, same four states (loading/none/error/ready). See the v1
 *  file for why this exists at all. */

import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
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
    <div className="v2-row">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="v2-label mb-0">{label}</p>
        {count !== undefined && (
          <span className="v2-mono text-xs text-[color:var(--v2-text-faint)] tabular-nums">
            {count}
          </span>
        )}
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
      <div className="v2-panel mt-4">
        <p className="flex items-center gap-2 text-sm text-[color:var(--v2-text-faint)] v2-sans">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          Reading your Stone…
        </p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="v2-panel mt-4">
        <p className="flex items-center gap-2 text-sm text-[color:var(--v2-text-dim)] v2-sans">
          <AlertCircle className="w-4 h-4 text-[color:var(--v2-warn)] shrink-0" aria-hidden />
          Could not read your Stone. The markdown above is unaffected — it is the source, and
          this panel is only what was understood from it.
        </p>
      </div>
    );
  }

  if (state === "none" || !profile) {
    return (
      <div className="v2-panel mt-4 flex flex-col gap-2">
        <p className="text-sm text-[color:var(--v2-text)] v2-sans">Nothing extracted yet.</p>
        <p className="text-sm text-[color:var(--v2-text-dim)] v2-sans">
          Import a resume or write one above, then save. Facet reads it in the background and
          what it understood appears here — every fact it is allowed to use, and nothing else.
        </p>
      </div>
    );
  }

  const roles = profile.roles ?? [];
  const skills = profile.skills ?? [];
  const contact = profile.contact ?? {};
  const contactLine = [contact.email, contact.phone, contact.location, contact.linkedin]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="v2-panel mt-4">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="v2-h2">What Facet understood</h2>
        <span className="v2-mono text-xs text-[color:var(--v2-text-faint)]">profile.json</span>
      </div>
      <p className="v2-sans text-xs text-[color:var(--v2-text-faint)] mb-3">
        The ceiling on every application. Nothing Facet writes can go beyond what is on this
        list. Read-only — the markdown above is the source, and editing two copies of one truth
        is how they drift apart.
      </p>

      <div className="border-t border-[color:var(--v2-border-soft)]">
        {(profile.name || contactLine) && (
          <Section label="Identity">
            {profile.name && (
              <p className="text-sm font-medium text-[color:var(--v2-text)] v2-sans">
                {profile.name}
              </p>
            )}
            {contactLine && (
              <p className="text-xs text-[color:var(--v2-text-dim)] v2-sans mt-0.5">
                {contactLine}
              </p>
            )}
          </Section>
        )}

        {profile.summary_base && (
          <Section label="Summary">
            <p className="text-sm text-[color:var(--v2-text-dim)] v2-sans leading-relaxed">
              {profile.summary_base}
            </p>
          </Section>
        )}

        {skills.length > 0 && (
          <Section label="Skills" count={skills.length}>
            <p className="text-sm text-[color:var(--v2-text-dim)] v2-sans leading-relaxed">
              {skills.join(" · ")}
            </p>
          </Section>
        )}

        {roles.length > 0 && (
          <Section label="Roles" count={roles.length}>
            <div className="flex flex-col gap-3">
              {roles.map((role, i) => (
                <div key={role.id ?? i}>
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <span className="text-sm font-medium text-[color:var(--v2-text)] v2-sans">
                      {role.title}
                    </span>
                    <span className="v2-mono text-xs text-[color:var(--v2-text-faint)]">
                      {formatRoleDate(role.start)} – {formatRoleDate(role.end)}
                    </span>
                  </div>
                  <p className="text-xs text-[color:var(--v2-text-dim)] v2-sans mt-0.5">
                    {role.company}
                    {role.location ? ` · ${role.location}` : ""}
                  </p>
                  <p className="text-xs text-[color:var(--v2-text-faint)] v2-mono mt-1 tabular-nums">
                    {role.bullets?.length ?? 0} bullet
                    {(role.bullets?.length ?? 0) === 1 ? "" : "s"}
                    {(role.bullets?.length ?? 0) === 0 && (
                      <span className="text-[color:var(--v2-warn)]">
                        {" "}
                        — nothing for the tailor to draw on
                      </span>
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
                  <span className="text-sm text-[color:var(--v2-text-dim)] v2-sans">
                    {entry.degree}
                  </span>
                  <span className="v2-mono text-xs text-[color:var(--v2-text-faint)]">
                    {formatRoleDate(entry.year)}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {(profile.certifications ?? []).length > 0 && (
          <Section label="Certifications" count={profile.certifications?.length}>
            <p className="text-sm text-[color:var(--v2-text-dim)] v2-sans">
              {profile.certifications
                ?.map((cert) => (typeof cert === "string" ? cert : cert.name))
                .filter(Boolean)
                .join(" · ")}
            </p>
          </Section>
        )}
      </div>
    </div>
  );
}
