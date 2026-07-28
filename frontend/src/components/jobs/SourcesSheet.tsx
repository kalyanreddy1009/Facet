"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Bell, KeyRound, Plus, Rss, Trash2 } from "lucide-react";
import Button from "@/components/ui/Button";
import Segmented from "@/components/ui/Segmented";
import Sheet from "@/components/ui/Sheet";
import { api, ApiError, type Feed, type FeedSuggestion, type Settings } from "@/lib/api";

interface SourcesSheetProps {
  open: boolean;
  onClose: () => void;
  query: string;
  location: string;
  onChanged: () => void;
  notify: (text: string, tone: "error" | "info" | "success", hint?: string) => void;
}

type Tab = "platforms" | "feeds" | "keys";

const TABS = [
  { value: "platforms" as const, label: "Platforms", icon: Bell },
  { value: "feeds" as const, label: "My feeds", icon: Rss },
  { value: "keys" as const, label: "API keys", icon: KeyRound },
];

export default function SourcesSheet({
  open,
  onClose,
  query,
  location,
  onChanged,
  notify,
}: SourcesSheetProps) {
  const [tab, setTab] = useState<Tab>("platforms");
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [suggestions, setSuggestions] = useState<FeedSuggestion[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [newFeed, setNewFeed] = useState({ label: "", url: "" });
  const [keys, setKeys] = useState({ adzuna_app_id: "", adzuna_app_key: "", jooble_key: "", adzuna_country: "in" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.listFeeds().then(setFeeds).catch(() => {});
    api.feedSuggestions(query, location).then(setSuggestions).catch(() => {});
    api
      .getSettings()
      .then((s) => {
        setSettings(s);
        setKeys((k) => ({ ...k, adzuna_country: s.adzuna_country || "in" }));
      })
      .catch(() => {});
  }, [query, location]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

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
    setFeeds((prev) => prev.filter((f) => f.url !== url)); // optimistic
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
      // Blank fields mean "leave what's stored alone", not "erase it".
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
    <Sheet
      open={open}
      onClose={onClose}
      title="Job sources"
      description="Where Facet looks for postings."
    >
      <div className="flex flex-col gap-5">
        <Segmented value={tab} segments={TABS} onChange={setTab} label="Source settings" size="sm" />

        {tab === "platforms" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-text-dim text-pretty">
              Facet never signs in to a job platform for you — that&apos;s how accounts get banned.
              Instead it builds the saved-search URL for
              {query ? ` “${query}”` : " your search"}. Feeds marked{" "}
              <span className="badge">RSS</span> can be added straight away; the rest open the
              platform so you can create the alert there.
            </p>

            {suggestions.map((suggestion) => (
              <div key={suggestion.url} className="panel-raised p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-text">{suggestion.platform}</span>
                  <span className="text-xs text-text-faint">
                    {suggestion.kind === "rss" ? "RSS" : "Alert"}
                  </span>
                </div>
                <p className="text-xs text-text-faint text-pretty">{suggestion.instructions}</p>
                <div className="flex gap-2">
                  {suggestion.kind === "rss" ? (
                    <Button
                      variant="primary"
                      icon={Plus}
                      onClick={() => addFeed({ url: suggestion.url, label: suggestion.label })}
                      disabled={feeds.some((f) => f.url === suggestion.url)}
                    >
                      {feeds.some((f) => f.url === suggestion.url) ? "Added" : "Add feed"}
                    </Button>
                  ) : (
                    <a
                      href={suggestion.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-primary"
                    >
                      Open {suggestion.platform}
                      <ArrowUpRight className="w-3.5 h-3.5" aria-hidden />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "feeds" && (
          <div className="flex flex-col gap-2">
            {feeds.length === 0 && (
              <p className="text-sm text-text-faint">
                No feeds subscribed. Add one below, or use the Platforms tab.
              </p>
            )}
            {feeds.map((feed) => (
              <div
                key={feed.url}
                className="panel-raised p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm text-text truncate">{feed.label}</p>
                  <p className="text-xs text-text-faint truncate">{feed.url}</p>
                </div>
                <button
                  onClick={() => removeFeed(feed.url)}
                  aria-label={`Remove ${feed.label}`}
                  className="btn btn-ghost text-danger shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            <div className="panel-raised p-3 flex flex-col gap-2 mt-2">
              <p className="label">Add a feed manually</p>
              <input
                className="field"
                placeholder="Label — e.g. LinkedIn Python Remote"
                value={newFeed.label}
                onChange={(e) => setNewFeed({ ...newFeed, label: e.target.value })}
              />
              <input
                className="field"
                placeholder="https://… RSS URL"
                value={newFeed.url}
                onChange={(e) => setNewFeed({ ...newFeed, url: e.target.value })}
              />
              <Button
                variant="primary"
                icon={Plus}
                disabled={!newFeed.url.trim() || !newFeed.label.trim()}
                onClick={() => addFeed({ url: newFeed.url.trim(), label: newFeed.label.trim() })}
              >
                Add feed
              </Button>
            </div>
          </div>
        )}

        {tab === "keys" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-dim text-pretty">
              Optional. Everything already works without these — they add coverage. Keys are stored
              locally in <span className="mono text-xs">data/settings.json</span> and are only ever
              sent to the provider they belong to.
            </p>

            <div className="panel-raised p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-text">Jooble</p>
                <span className={`badge ${settings?.jooble_configured ? "badge-ok" : ""}`}>
                  {settings?.jooble_configured ? "Configured" : "Not set"}
                </span>
              </div>
              <p className="text-xs text-text-faint text-pretty">
                The one that reaches LinkedIn, Indeed and Naukri listings — their index already
                aggregates those boards. Free key at jooble.org/api/about.
              </p>
              <input
                className="field mono text-xs"
                type="password"
                placeholder="Jooble API key"
                value={keys.jooble_key}
                onChange={(e) => setKeys({ ...keys, jooble_key: e.target.value })}
              />
            </div>

            <div className="panel-raised p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-text">Adzuna</p>
                <span className={`badge ${settings?.adzuna_configured ? "badge-ok" : ""}`}>
                  {settings?.adzuna_configured ? "Configured" : "Not set"}
                </span>
              </div>
              <p className="text-xs text-text-faint text-pretty">
                Strong country-specific coverage including India. Free key at developer.adzuna.com.
              </p>
              <input
                className="field mono text-xs"
                placeholder="App ID"
                value={keys.adzuna_app_id}
                onChange={(e) => setKeys({ ...keys, adzuna_app_id: e.target.value })}
              />
              <input
                className="field mono text-xs"
                type="password"
                placeholder="App key"
                value={keys.adzuna_app_key}
                onChange={(e) => setKeys({ ...keys, adzuna_app_key: e.target.value })}
              />
              <label className="text-xs text-text-faint">
                Country code
                <input
                  className="field mt-1"
                  maxLength={2}
                  value={keys.adzuna_country}
                  onChange={(e) => setKeys({ ...keys, adzuna_country: e.target.value.toLowerCase() })}
                />
              </label>
            </div>

            <Button variant="primary" onClick={saveKeys} loading={busy}>
              Save keys
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
