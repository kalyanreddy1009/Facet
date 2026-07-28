// Same-origin by default: next.config.mjs proxies /api/* to the backend in
// every environment, so no host or port is baked into the bundle and one
// build runs anywhere. Set NEXT_PUBLIC_API_BASE only to bypass that proxy.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";

export class ApiError extends Error {
  hint?: string;
  status: number;
  constructor(message: string, hint?: string, status = 0) {
    super(message);
    this.hint = hint;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT = 20_000;

/**
 * Every call is abortable and time-boxed. A hung backend must surface as a
 * clear error, never as a spinner that spins forever.
 */
async function request<T>(
  path: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT, signal, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  // Caller-supplied signals (a superseded search) must still win.
  signal?.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      ...init,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(
        body.detail || body.error || `Request failed (${res.status})`,
        body.hint,
        res.status
      );
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      // A superseded request isn't a failure — let callers ignore it by name.
      throw new ApiError(signal?.aborted ? "aborted" : "The request timed out", undefined, 0);
    }
    throw new ApiError(
      "Can't reach the Facet backend",
      "Is it running on :8000? Start it with `python run.py`."
    );
  } finally {
    clearTimeout(timer);
  }
}

export const isAborted = (err: unknown) => err instanceof ApiError && err.message === "aborted";

/* ------------------------------------------------------------------ types */

export interface Application {
  id: number;
  company: string;
  role_title: string;
  target_role: string | null;
  job_description: string | null;
  ats_score: number | null;
  resume_path: string | null;
  docx_path: string | null;
  cover_letter_path: string | null;
  recruiter_summary: string | null;
  status: "Saved" | "Cut" | "Set" | "Interviewing" | "Rejected" | "Offer";
  job_url: string | null;
  company_domain: string | null;
  created_at: string;
  updated_at: string;
  notes: string | null;
}

export interface Contact {
  id: number;
  application_id: number;
  name: string;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  notes: string | null;
  created_at: string;
}

export interface Interview {
  id: number;
  application_id: number;
  contact_id: number | null;
  round_name: string | null;
  scheduled_at: string | null;
  completed: number;
  outcome: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardSummary {
  response_rate: number | null;
  funnel: { Cut: number; Set: number; Interviewing: number; Offer: number };
  rejected_count: number;
  needs_followup: Application[];
  cut_vs_set: { cut: number; set: number; gap: number };
  cut_not_sent_yet: Application[];
  clarity_score_trend: Array<{
    id: number;
    company: string;
    role_title: string;
    ats_score: number;
    created_at: string;
  }>;
}

export interface TailoredFields {
  match_score: number;
  matching_skills: string[];
  inferred_skills: string[];
  missing_but_true: string[];
  missing_and_absent: string[];
  tailored_summary: string;
  tailored_skills_order: string[];
  role_bullets: Record<string, string[]>;
  cover_letter_body: string;
  recruiter_summary: string;
}

export interface TailorResponse {
  weak_match: boolean;
  truthfulness_mode: "strict" | "inferred_adjacent";
  tailored_fields: TailoredFields;
  application: Application;
}

export interface TailorRequestBody {
  company: string;
  role_title: string;
  job_description: string;
  truthfulness_mode: "strict" | "inferred_adjacent";
  target_role?: string;
  job_url?: string;
  application_id?: number;
}

export interface Feed {
  url: string;
  label: string;
}

export interface FeedSuggestion {
  platform: string;
  kind: "rss" | "alert";
  label: string;
  url: string;
  instructions: string;
}

export interface Job {
  id: number;
  posting_hash: string;
  source: string | null;
  source_feed: string | null;
  company: string | null;
  title: string | null;
  posting_url: string | null;
  posted_date: string | null;
  first_seen_at: string;
  last_seen_at: string | null;
  summary: string | null;
  match_score: number | null;
  location: string | null;
  remote: number;
  employment_type: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  tags: string[];
  /** The Stone skills this posting mentions — the evidence behind match_score.
   *  Empty for rows last ingested before the column existed; they fill in on
   *  the next sync. */
  match_terms: string[];
  promoted: number;
  dismissed: number;
}

export interface JobPage {
  total: number;
  limit: number;
  offset: number;
  items: Job[];
}

export interface JobFacets {
  sources: Array<{ source: string; count: number }>;
  employment_types: Array<{ value: string; count: number }>;
  total: number;
  remote_count: number;
  with_salary: number;
  available_providers: string[];
}

export interface JobQuery {
  q?: string;
  location?: string;
  source?: string[];
  remote?: boolean | null;
  employment_type?: string;
  min_score?: number;
  max_age_days?: number | null;
  salary_min?: number | null;
  sort?: "match" | "recent" | "salary" | "company" | "title";
  limit?: number;
  offset?: number;
}

export interface SyncReport {
  sources: Record<string, { count?: number; ms?: number; error?: string }>;
  stored: number;
  new: number;
  skipped_stale: number;
}

export interface Settings {
  adzuna_country: string;
  default_location: string;
  enabled_sources: string[];
  adzuna_configured: boolean;
  jooble_configured: boolean;
}

export interface ExtractionStatus {
  status: "idle" | "running" | "done" | "error";
  error: { error: string; hint?: string } | null;
}

/* --------------------------------------------------------------- querying */

function toQueryString(query: JobQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, String(v)));
    else params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export const api = {
  /* tracker */
  listApplications: () => request<Application[]>("/api/applications"),
  updateApplication: (id: number, body: Partial<Application>) =>
    request<Application>(`/api/applications/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  listContacts: (applicationId?: number) =>
    request<Contact[]>(
      applicationId ? `/api/contacts?application_id=${applicationId}` : "/api/contacts"
    ),
  listInterviews: (applicationId?: number) =>
    request<Interview[]>(
      applicationId ? `/api/interviews?application_id=${applicationId}` : "/api/interviews"
    ),
  dashboardSummary: () => request<DashboardSummary>("/api/dashboard/summary"),

  /* profile + resume */
  profileExists: async (): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/profile`);
      return res.ok;
    } catch {
      return false;
    }
  },
  getMasterResume: () => request<{ markdown: string }>("/api/resume/master"),
  saveMasterResume: (markdown: string) =>
    request<{ saved: boolean; extraction: string }>("/api/resume/master", {
      method: "POST",
      body: JSON.stringify({ markdown }),
    }),
  extractionStatus: () => request<ExtractionStatus>("/api/resume/extraction-status"),
  importResume: async (file: File): Promise<{ markdown: string }> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/api/resume/import`, { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.detail || body.error || `Request failed (${res.status})`, body.hint, res.status);
    }
    return res.json();
  },

  /* tailoring */
  tailor: (body: TailorRequestBody) =>
    // agy runs a real model — this one is allowed to take minutes.
    request<TailorResponse>("/api/tailor", {
      method: "POST",
      body: JSON.stringify(body),
      timeout: 330_000,
    }),
  agyHealth: () => request<{ available: boolean; detail: string }>("/api/agy/health"),

  /* jobs */
  jobs: (query: JobQuery, signal?: AbortSignal) =>
    request<JobPage>(`/api/jobs${toQueryString(query)}`, { signal }),
  jobFacets: (query: JobQuery, signal?: AbortSignal) =>
    request<JobFacets>(`/api/jobs/facets${toQueryString(query)}`, { signal }),
  liveSearch: (q: string, location: string) =>
    request<SyncReport>("/api/jobs/search", {
      method: "POST",
      body: JSON.stringify({ q, location }),
      timeout: 90_000,
    }),
  syncFeeds: () => request<SyncReport>("/api/feeds/sync", { method: "POST", timeout: 90_000 }),
  promoteJob: (id: number) => request<Job>(`/api/rough/${id}/promote`, { method: "POST" }),
  dismissJob: (id: number) => request<{ dismissed: boolean }>(`/api/rough/${id}/dismiss`, { method: "POST" }),
  restoreJob: (id: number) => request<{ dismissed: boolean }>(`/api/rough/${id}/restore`, { method: "POST" }),

  /* feeds + settings */
  listFeeds: () => request<Feed[]>("/api/feeds"),
  addFeed: (feed: Feed) => request<Feed[]>("/api/feeds", { method: "POST", body: JSON.stringify(feed) }),
  removeFeed: (url: string) =>
    request<Feed[]>(`/api/feeds?url=${encodeURIComponent(url)}`, { method: "DELETE" }),
  feedSuggestions: (q: string, location: string) =>
    request<FeedSuggestion[]>(
      `/api/feeds/builder?q=${encodeURIComponent(q)}&location=${encodeURIComponent(location)}`
    ),
  getSettings: () => request<Settings>("/api/settings"),
  saveSettings: (patch: Record<string, unknown>) =>
    request<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(patch) }),
};

export { API_BASE };
