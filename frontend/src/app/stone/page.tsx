"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  Save,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { api, ApiError, type ExtractionStatus } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import Toaster from "@/components/ui/Toaster";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToasts } from "@/lib/useToasts";

const ACCEPTED = [".pdf", ".docx"];

export default function StonePage() {
  const { toasts, push, dismiss } = useToasts();
  const [markdown, setMarkdown] = useState("");
  const [savedMarkdown, setSavedMarkdown] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [extraction, setExtraction] = useState<ExtractionStatus | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .getMasterResume()
      .then((res) => {
        setMarkdown(res.markdown);
        setSavedMarkdown(res.markdown);
      })
      .catch(() => {}) // no stone yet is the normal first-run state
      .finally(() => setLoaded(true));
  }, []);

  // Poll only while an extraction is actually running.
  useEffect(() => {
    if (extraction?.status !== "running") return;
    const interval = setInterval(async () => {
      const status = await api.extractionStatus().catch(() => null);
      if (!status) return;
      setExtraction(status);
      if (status.status === "error" && status.error) {
        push(status.error.error, { hint: status.error.hint });
      } else if (status.status === "done") {
        push("Profile extracted — your Stone is in sync.", { tone: "success" });
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [extraction, push]);

  const dirty = markdown !== savedMarkdown;

  // Losing an edited resume to a stray tab close is not recoverable.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const importFile = useCallback(
    async (file: File) => {
      if (!ACCEPTED.some((ext) => file.name.toLowerCase().endsWith(ext))) {
        push("Only PDF and DOCX resumes can be imported", { hint: `Got ${file.name}` });
        return;
      }
      setImporting(true);
      try {
        const res = await api.importResume(file);
        setMarkdown(res.markdown);
        push("Imported — check the markdown below, then save.", {
          tone: "success",
          hint: "Parsing is mechanical; it gets headings wrong sometimes.",
        });
      } catch (err) {
        push(err instanceof ApiError ? err.message : "Import failed", {
          hint: err instanceof ApiError ? err.hint : undefined,
        });
      } finally {
        setImporting(false);
      }
    },
    [push]
  );

  const save = async () => {
    setSaving(true);
    try {
      await api.saveMasterResume(markdown);
      setSavedMarkdown(markdown);
      setExtraction({ status: "running", error: null });
      push("Saved. Extracting your profile in the background…", { tone: "success" });
    } catch (err) {
      push(err instanceof ApiError ? err.message : "Save failed", {
        hint: err instanceof ApiError ? err.hint : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const words = markdown.trim() ? markdown.trim().split(/\s+/).length : 0;

  if (!loaded) {
    return (
      <main className="max-w-4xl mx-auto px-5 sm:px-8 py-8 sm:py-10 flex flex-col gap-5">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-[28rem] w-full" />
      </main>
    );
  }

  return (
    <main className="max-w-4xl mx-auto px-5 sm:px-8 py-8 sm:py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-text">Your Stone</h1>
        <p className="text-sm text-text-dim mt-1 max-w-prose text-pretty">
          The permanent, honest record of your background. Every facet is cut from this and nothing
          else — so it&apos;s worth getting exactly right.
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
        className={`panel p-4 flex flex-wrap items-center justify-between gap-3 transition-colors duration-fast ${
          dragging ? "border-accent-border bg-accent-soft" : ""
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
          <Button icon={UploadCloud} loading={importing} onClick={() => fileInput.current?.click()}>
            Import PDF or DOCX
          </Button>
          <span className="text-sm text-text-faint">
            {dragging ? "Drop to import" : "…or drop a file here"}
          </span>

          {extraction?.status === "running" && (
            <span className="text-sm text-warn-text flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              Extracting profile…
            </span>
          )}
          {extraction?.status === "done" && (
            <span className="text-sm text-ok-text flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
              Profile in sync
            </span>
          )}
        </div>

        <span className="text-xs text-text-faint tnum">
          {words.toLocaleString()} words · {markdown.length.toLocaleString()} chars
        </span>
      </div>

      <Panel className="mt-4 p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between divider pb-2.5 px-1">
          <span className="mono text-xs text-text-faint">
            master_resume.md {dirty && <span className="text-warn-text">· unsaved</span>}
          </span>
          <button
            type="button"
            onClick={async () => {
              if (!(await copyText(markdown))) return;
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
            className="btn btn-ghost btn-sm"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5" aria-hidden />
            ) : (
              <Copy className="w-3.5 h-3.5" aria-hidden />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <textarea
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          rows={24}
          spellCheck={false}
          aria-label="Master resume markdown"
          className="w-full bg-transparent mono text-sm text-text outline-none resize-y leading-relaxed p-2 placeholder:text-text-ghost"
          placeholder="Write your full resume in Markdown here, or import a file above…"
        />
      </Panel>

      <div className="flex flex-wrap items-center gap-3 mt-4">
        <Button
          variant="primary"
          icon={Save}
          cap={dirty ? ArrowRight : undefined}
          onClick={save}
          loading={saving}
          disabled={!dirty || !markdown.trim()}
          className="btn-lg"
        >
          {dirty ? "Save stone" : "Saved"}
        </Button>
        <p className="text-sm text-text-faint flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden />
          Written to master_resume.md on this machine, then extracted into profile.json.
        </p>
      </div>

      <Toaster toasts={toasts} onDismiss={dismiss} />
    </main>
  );
}
