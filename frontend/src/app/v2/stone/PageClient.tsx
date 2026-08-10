"use client";

/** v2 skin of `app/stone/PageClient.tsx`. Same load/save/import/extraction-
 *  poll logic via lib/api.ts, same load-error guard against overwriting a
 *  real Stone with an empty editor. See the v1 file for the reasoning behind
 *  each behaviour; only the markup, classes and feedback surface (a status
 *  line instead of the v1 Toaster) differ. */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Loader2, Save, ShieldCheck, UploadCloud } from "lucide-react";
import { api, ApiError, type ExtractionStatus } from "@/lib/api";
import ExtractedStone from "@/components-v2/stone/ExtractedStone";

const ACCEPTED = [".pdf", ".docx"];

export default function StonePage() {
  const [markdown, setMarkdown] = useState("");
  const [savedMarkdown, setSavedMarkdown] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [extraction, setExtraction] = useState<ExtractionStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string; hint?: string } | null>(
    null
  );
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoadError(null);
    api
      .getMasterResume()
      .then((res) => {
        setMarkdown(res.markdown);
        setSavedMarkdown(res.markdown);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) return;
        setLoadError(
          err instanceof ApiError && err.message
            ? err.message
            : "Could not reach the server to load your Stone."
        );
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const extractionStatus = extraction?.status;
  useEffect(() => {
    if (extractionStatus !== "running") return;
    let failures = 0;
    const interval = setInterval(async () => {
      if (document.hidden) return;
      const status = await api.extractionStatus().catch(() => null);
      if (!status) {
        if (++failures < 4) return;
        clearInterval(interval);
        setExtraction({
          status: "error",
          error: {
            error: "Lost track of the extraction",
            hint: "Your resume is saved. Reload to see whether the profile finished.",
          },
        });
        setMessage({
          ok: false,
          text: "Lost track of the extraction",
          hint: "Your resume is saved. Reload to see whether the profile finished.",
        });
        return;
      }
      failures = 0;
      setExtraction(status);
      if (status.status === "error" && status.error) {
        setMessage({ ok: false, text: status.error.error, hint: status.error.hint });
      } else if (status.status === "done") {
        setMessage({ ok: true, text: "Profile extracted — your Stone is in sync." });
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [extractionStatus]);

  const dirty = markdown !== savedMarkdown;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const importFile = useCallback(async (file: File) => {
    if (!ACCEPTED.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      setMessage({ ok: false, text: "Only PDF and DOCX resumes can be imported", hint: `Got ${file.name}` });
      return;
    }
    setImporting(true);
    try {
      const res = await api.importResume(file);
      setMarkdown(res.markdown);
      setMessage({
        ok: true,
        text: "Imported — check the markdown below, then save.",
        hint: "Parsing is mechanical; it gets headings wrong sometimes.",
      });
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof ApiError ? err.message : "Import failed",
        hint: err instanceof ApiError ? err.hint : undefined,
      });
    } finally {
      setImporting(false);
    }
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveMasterResume(markdown);
      setSavedMarkdown(markdown);
      setExtraction({ status: "running", error: null });
      setMessage({ ok: true, text: "Saved. Extracting your profile in the background…" });
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof ApiError ? err.message : "Save failed",
        hint: err instanceof ApiError ? err.hint : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "s" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      if (dirty && markdown.trim() && !saving) saveRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, markdown, saving]);

  const words = markdown.trim() ? markdown.trim().split(/\s+/).length : 0;

  if (!loaded) {
    return (
      <main className="v2-main flex flex-col gap-5">
        <div className="v2-panel h-24 animate-pulse" />
        <div className="v2-panel h-[28rem] animate-pulse" />
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="v2-main">
        <header className="mb-6">
          <p className="v2-eyebrow">Stone</p>
          <h1 className="v2-h1 mt-1">Your Stone</h1>
        </header>
        <div className="v2-panel flex flex-col gap-3 items-start">
          <p className="text-sm text-[color:var(--v2-text)] v2-sans">{loadError}</p>
          <p className="text-sm text-[color:var(--v2-text-dim)] v2-sans">
            Your Stone has not been changed. The editor stays closed until it loads, so nothing
            can be saved over it by mistake.
          </p>
          <button className="v2-btn" onClick={load}>
            Try again
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="v2-main">
      <header className="mb-6">
        <p className="v2-eyebrow">Stone</p>
        <h1 className="v2-h1 mt-1">Your Stone</h1>
        <p className="v2-lede mt-2">
          The permanent, honest record of your background. Every facet is cut from this and
          nothing else — so it&apos;s worth getting exactly right.
        </p>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) importFile(file);
        }}
        className={`v2-panel flex flex-wrap items-center justify-between gap-3 transition-colors ${
          dragging ? "border-[color:var(--v2-accent)]" : ""
        }`}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED.join(",")}
            aria-label="Import a resume file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importFile(file);
              e.target.value = "";
            }}
          />
          <button className="v2-btn" disabled={importing} onClick={() => fileInput.current?.click()}>
            {importing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
            ) : (
              <UploadCloud className="w-3.5 h-3.5" aria-hidden />
            )}
            Import PDF or DOCX
          </button>
          <span className="v2-sans text-sm text-[color:var(--v2-text-faint)]">
            {dragging ? "Drop to import" : "…or drop a file here"}
          </span>

          {extraction?.status === "running" && (
            <span className="v2-sans text-sm text-[color:var(--v2-warn)] flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              Extracting profile…
            </span>
          )}
          {extraction?.status === "done" && (
            <span className="v2-sans text-sm text-[color:var(--v2-ok)] flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
              Profile in sync
            </span>
          )}
        </div>

        <span className="v2-mono text-xs text-[color:var(--v2-text-faint)] tabular-nums">
          {words.toLocaleString()} words · {markdown.length.toLocaleString()} chars
        </span>
      </div>

      <div className="v2-panel mt-4 flex flex-col gap-2">
        <div className="flex items-center justify-between border-b border-[color:var(--v2-border-soft)] pb-2.5 mb-1">
          <span className="v2-mono text-xs text-[color:var(--v2-text-faint)]">
            master_resume.md {dirty && <span className="text-[color:var(--v2-warn)]">· unsaved</span>}
          </span>
        </div>

        <textarea
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          rows={24}
          spellCheck={false}
          aria-label="Master resume markdown"
          className="v2-field v2-mono text-sm resize-y leading-relaxed"
          placeholder="Write your full resume in Markdown here, or import a file above…"
        />
      </div>

      <ExtractedStone />

      {message && (
        <p
          role="status"
          aria-live="polite"
          className={`v2-sans mt-4 text-sm ${
            message.ok ? "text-[color:var(--v2-text-dim)]" : "text-[color:var(--v2-danger)]"
          }`}
        >
          {message.text}
          {message.hint && (
            <span className="block text-xs text-[color:var(--v2-text-faint)] mt-0.5">
              {message.hint}
            </span>
          )}
        </p>
      )}

      <div className="v2-actionbar">
        <button
          className="v2-btn v2-btn-primary"
          onClick={save}
          title="Save your stone (⌘S / Ctrl+S)"
          disabled={!dirty || !markdown.trim() || saving}
          aria-busy={saving || undefined}
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          ) : (
            <Save className="w-4 h-4" aria-hidden />
          )}
          {dirty ? "Save stone" : "Saved"}
          {dirty && <ArrowRight className="w-3.5 h-3.5" aria-hidden />}
        </button>
        <p className="v2-sans text-sm text-[color:var(--v2-text-faint)] flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden />
          Written to your master_resume.md, then extracted into your profile.json. Nobody else
          on this Facet can read either one.
        </p>
      </div>
    </main>
  );
}
