"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Plus, Trash2 } from "lucide-react";
import { api, ApiError, type Feed, type FeedSuggestion, type Settings } from "@/lib/api";
import { useModal } from "@/lib/useModal";

interface SourcesSheetProps {
  open: boolean;
  onClose: () => void;
  query: string;
  location: string;
  onChanged: () => void;
  notify: (text: string, tone: "error" | "info" | "success", hint?: string) => void;
}

type Tab = "platforms" | "feeds" | "keys";

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "platforms", label: "Platforms" },
  { value: "feeds", label: "My feeds" },
  { value: "keys", label: "API keys" },
];

/** v2's equivalent of `components/jobs/SourcesSheet.tsx` — same three tabs,
 *  same API calls, same "a failed load is not an empty account" contract —
 *  as a flat-bordered centered dialog instead of v1's slide-over sheet. */
export default function SourcesSheet({ open, onClose, query, location, onChanged, notify }: SourcesSheetProps) {
  const [tab, setTab] = useState<Tab>("platforms");
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [suggestions, setSuggestions] = useState<FeedSuggestion[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [newFeed, setNewFeed] = useState({ label: "", url: "" });
  const [keys, setKeys] = useState({ adzuna_app_id: "", adzuna_app_key: "", jooble_key: "", adzuna_country: "in" });
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useModal(open, onClose, panelRef);

  const load = useCallback(() => {
    setLoadError(null);
    const fail = () => setLoadError("Couldn't load your saved sources. This list may be incomplete.");
    api.listFeeds().then(setFeeds).catch(fail);
    api.feedSuggestions(query, location).then(setSuggestions).catch(() => {});
    api
      .getSettings()
      .then((s) => {
        setSettings(s);
        setKeys((k) => ({ ...k, adzuna_country: s.adzuna_country || "in" }));
      })
      .catch(fail);
  }, [query, location]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!open) return null;

  const addFeed = async (feed: Feed) => {
    try {
      setFeeds(await api.addFeed(feed));
      setNewFeed({ label: "", url: "" });
      notify(`Subscribed to ${feed.label}`, "success", "It'll be included in the next sync.");
      onChanged();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Couldn't add that feed", "error");
    }
  };

  const removeFeed = async (url: string) => {
    const previous = feeds;
    setFeeds((prev) => prev.filter((f) => f.url !== url));
    try {
      setFeeds(await api.removeFeed(url));
    } catch {
      setFeeds(previous);
      notify("Couldn't remove that feed", "error");
    }
  };

  const saveKeys = async () => {
    setBusy(true);
    try {
      const patch = Object.fromEntries(Object.entries(keys).filter(([, v]) => v));
      setSettings(await api.saveSettings(patch));
      setKeys((k) => ({ ...k, adzuna_app_id: "", adzuna_app_key: "", jooble_key: "" }));
      notify("Keys saved — those sources are live on the next search.", "success");
      onChanged();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Couldn't save settings", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Job sources"
        className="v2-panel v2-sans w-full max-w-lg max-h-[85vh] overflow-y-auto outline-none"
      >
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 className="v2-h2">Job sources</h2>
          <button type="button" onClick={onClose} className="v2-btn" aria-label="Close">
            ✕
          </button>
        </div>
        <p className="text-sm mb-4" style={{ color: "var(--v2-text-dim)" }}>
          Where Facet looks for postings.
        </p>

        <div className="flex gap-2 mb-4" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => setTab(t.value)}
              className="v2-btn"
              style={
                tab === t.value
                  ? { background: "var(--v2-panel)", borderColor: "var(--v2-accent)", color: "var(--v2-text)" }
                  : undefined
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {loadError && (
          <div className="v2-panel-tight v2-panel mb-4 flex items-center justify-between gap-3">
            <p className="text-sm" style={{ color: "var(--v2-danger)" }}>
              {loadError}
            </p>
            <button type="button" onClick={load} className="v2-btn shrink-0">
              Retry
            </button>
          </div>
        )}

        {tab === "platforms" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-pretty mb-2" style={{ color: "var(--v2-text-dim)" }}>
              Facet never signs in to a job platform for you. Instead it builds the saved-search URL
              for{query ? ` "${query}"` : " your search"}. Feeds marked <span className="v2-badge">RSS</span> can
              be added straight away; the rest open the platform so you can create the alert there.
            </p>
            {suggestions.map((suggestion) => (
              <div key={suggestion.url} className="v2-row flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium" style={{ color: "var(--v2-text)" }}>
                    {suggestion.platform}
                  </span>
                  <span className="text-xs" style={{ color: "var(--v2-text-faint)" }}>
                    {suggestion.kind === "rss" ? "RSS" : "Alert"}
                  </span>
                </div>
                <p className="text-xs text-pretty" style={{ color: "var(--v2-text-faint)" }}>
                  {suggestion.instructions}
                </p>
                {suggestion.kind === "rss" ? (
                  <button
                    type="button"
                    className="v2-btn v2-btn-primary self-start"
                    onClick={() => addFeed({ url: suggestion.url, label: suggestion.label })}
                    disabled={feeds.some((f) => f.url === suggestion.url)}
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden />
                    {feeds.some((f) => f.url === suggestion.url) ? "Added" : "Add feed"}
                  </button>
                ) : (
                  <a href={suggestion.url} target="_blank" rel="noopener noreferrer" className="v2-btn v2-btn-primary self-start">
                    Open {suggestion.platform}
                    <ArrowUpRight className="w-3.5 h-3.5" aria-hidden />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "feeds" && (
          <div className="flex flex-col gap-2">
            {feeds.length === 0 && (
              <p className="text-sm" style={{ color: "var(--v2-text-faint)" }}>
                No feeds subscribed. Add one below, or use the Platforms tab.
              </p>
            )}
            {feeds.map((feed) => (
              <div key={feed.url} className="v2-row flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm truncate" style={{ color: "var(--v2-text)" }}>
                    {feed.label}
                  </p>
                  <p className="text-xs truncate" style={{ color: "var(--v2-text-faint)" }}>
                    {feed.url}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeFeed(feed.url)}
                  aria-label={`Remove ${feed.label}`}
                  className="v2-btn shrink-0"
                  style={{ color: "var(--v2-danger)" }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            <div className="v2-panel-tight v2-panel flex flex-col gap-2 mt-2">
              <p className="v2-label">Add a feed manually</p>
              <input
                className="v2-field"
                aria-label="Feed name"
                placeholder="Label — e.g. LinkedIn Python Remote"
                value={newFeed.label}
                onChange={(e) => setNewFeed({ ...newFeed, label: e.target.value })}
              />
              <input
                className="v2-field"
                aria-label="Feed URL"
                placeholder="https://… RSS URL"
                value={newFeed.url}
                onChange={(e) => setNewFeed({ ...newFeed, url: e.target.value })}
              />
              <button
                type="button"
                className="v2-btn v2-btn-primary self-start"
                disabled={!newFeed.url.trim() || !newFeed.label.trim()}
                onClick={() => addFeed({ url: newFeed.url.trim(), label: newFeed.label.trim() })}
              >
                <Plus className="w-3.5 h-3.5" aria-hidden />
                Add feed
              </button>
            </div>
          </div>
        )}

        {tab === "keys" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-pretty" style={{ color: "var(--v2-text-dim)" }}>
              Optional. Everything already works without these. Keys are stored locally in{" "}
              <span className="v2-mono text-xs">data/settings.json</span> and are only ever sent to the
              provider they belong to.
            </p>

            <div className="v2-panel-tight v2-panel flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium" style={{ color: "var(--v2-text)" }}>
                  Jooble
                </p>
                <span className={`v2-badge ${settings?.jooble_configured ? "v2-badge-ok" : ""}`}>
                  {settings?.jooble_configured ? "Configured" : "Not set"}
                </span>
              </div>
              <input
                className="v2-field v2-mono text-xs"
                type="password"
                aria-label="Jooble API key"
                placeholder="Jooble API key"
                value={keys.jooble_key}
                onChange={(e) => setKeys({ ...keys, jooble_key: e.target.value })}
              />
            </div>

            <div className="v2-panel-tight v2-panel flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium" style={{ color: "var(--v2-text)" }}>
                  Adzuna
                </p>
                <span className={`v2-badge ${settings?.adzuna_configured ? "v2-badge-ok" : ""}`}>
                  {settings?.adzuna_configured ? "Configured" : "Not set"}
                </span>
              </div>
              <input
                className="v2-field v2-mono text-xs"
                aria-label="Adzuna app ID"
                placeholder="App ID"
                value={keys.adzuna_app_id}
                onChange={(e) => setKeys({ ...keys, adzuna_app_id: e.target.value })}
              />
              <input
                className="v2-field v2-mono text-xs"
                type="password"
                aria-label="Adzuna app key"
                placeholder="App key"
                value={keys.adzuna_app_key}
                onChange={(e) => setKeys({ ...keys, adzuna_app_key: e.target.value })}
              />
              <label className="text-xs" style={{ color: "var(--v2-text-faint)" }}>
                Country code
                <input
                  className="v2-field mt-1"
                  maxLength={2}
                  value={keys.adzuna_country}
                  onChange={(e) => setKeys({ ...keys, adzuna_country: e.target.value.toLowerCase() })}
                />
              </label>
            </div>

            <button type="button" className="v2-btn v2-btn-primary" onClick={saveKeys} disabled={busy}>
              {busy ? "Saving…" : "Save keys"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
