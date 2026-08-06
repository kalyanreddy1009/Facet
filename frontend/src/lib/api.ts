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
/**
 * Send an expired session to the login page, once.
 *
 * Guarded because a dashboard fires several requests at once: without the
 * flag, five simultaneous 401s queue five navigations and the `next`
 * parameter ends up pointing at `/login` itself.
 */
let redirecting = false;

/** The pages where a 401 is the normal state of the world, not an expired
 *  session. Someone setting a first password *has* no session — that is the
 *  entire point of the page they are on. Bouncing them to
 *  `/login?reason=expired` throws away the token in their URL and tells them
 *  their session ended, which is both untrue and unrecoverable: the link is
 *  no longer on screen to click again. */
const ANONYMOUS_PAGES = ["/login", "/set-password", "/"];

function redirectToLogin(): void {
  if (typeof window === "undefined" || redirecting) return;
  const here = window.location.pathname;
  if (ANONYMOUS_PAGES.some((page) => here === page || here.startsWith(page + "/"))) return;
  redirecting = true;
  clearApiCache();
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login?reason=expired&next=${next}`;
}

/* --------------------------------------------------------------- memory
 *
 * A read this tab has already done, kept in memory.
 *
 * The Cabinet fires four requests on every mount and The Rough two; walking
 * Cabinet → Rough → Cabinet re-ran all of them and repainted from skeletons
 * each time, even though nothing had changed in the four seconds between.
 * Now the second visit paints from RAM.
 *
 * Three rules keep it honest:
 *   - Opt-in by prefix, never blanket. `/api/queue/:id` and the extraction
 *     status are polled precisely because they change under you; a cache
 *     there would be a hang, not a speedup.
 *   - Any non-GET drops the whole cache. Cheap, and it means no mutation
 *     needs to remember which reads it invalidated — the mistake that makes
 *     caches show people stale rows after their own edit.
 *   - In-flight requests are shared, so the Cabinet's four parallel calls
 *     can't become eight when a re-render lands mid-flight.
 *
 * Held per tab and lost on reload: no storage, nothing on disk, nothing to
 * leak between accounts on a shared machine.
 */
const CACHEABLE = [
  "/api/applications",
  "/api/contacts",
  "/api/interviews",
  "/api/dashboard/summary",
  "/api/jobs",
  "/api/feeds",
  "/api/settings",
  "/api/resume/master",
];

/** Long enough to cover navigating away and back, short enough that a change
 *  made elsewhere (the scheduler ingesting a feed) surfaces on its own. */
const CACHE_TTL = 30_000;

const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

function cacheable(path: string, method: string, signal?: AbortSignal | null): boolean {
  if (method !== "GET") return false;
  // A caller holding an abort signal owns the lifetime of its request — the
  // search box cancels superseded ones. Sharing that promise with a second
  // caller would let one component's cancellation reject the other's read.
  if (signal) return false;
  const base = path.split("?")[0];
  return CACHEABLE.some((p) => base === p || base.startsWith(p + "/"));
}

/** Called after every write, and on sign-out. */
export function clearApiCache(): void {
  cache.clear();
  inflight.clear();
}

async function request<T>(
  path: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<T> {
  const method = (options.method || "GET").toUpperCase();

  if (cacheable(path, method, options.signal)) {
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value as T;
    const pending = inflight.get(path);
    if (pending) return pending as Promise<T>;
    const run = send<T>(path, options)
      .then((value) => {
        cache.set(path, { at: Date.now(), value });
        return value;
      })
      .finally(() => inflight.delete(path));
    inflight.set(path, run);
    return run;
  }

  if (method !== "GET") clearApiCache();
  return send<T>(path, options);
}

async function send<T>(
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
      // The session cookie has to ride along. Without this every request is
      // anonymous and the whole app looks signed out.
      credentials: "include",
      signal: controller.signal,
      ...init,
    });
    if (res.status === 401) {
      // A session that ended mid-use. Handled here rather than in each
      // caller: there are dozens of call sites and any one that forgot would
      // show an error toast where a login page belongs.
      redirectToLogin();
      throw new ApiError("Your session has ended", "Sign in again.", 401);
    }
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
      "It may be restarting. If this persists, check that the Facet backend is running."
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

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

/** A row in the work queue. agy takes up to five minutes and only one run
 *  happens at a time, so the work is enqueued and polled rather than held
 *  open on a request — no proxy will keep a connection alive that long
 *  (Cloudflare's free tier cuts at 100s), and a queued cut survives the tab
 *  being closed. */
export interface QueueJob {
  id: number;
  kind: string;
  status: JobStatus;
  result: unknown;
  error: string | null;
  error_kind: string | null;
  /** 1-based place in line while queued, null once it starts. */
  position: number | null;
  queued_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface TailorRequestBody {
  company: string;
  role_title: string;
  job_description: string;
  truthfulness_mode: "strict" | "inferred_adjacent";
  target_role?: string;
  job_url?: string;
  application_id?: number;
  /** Which of the seven resume templates to render. Omitted means "the one
   *  the last cut used", which the server resolves — so a request from a
   *  device that has never seen the picker still gets the right document. */
  resume_template?: string;
}

/** One resume template, as the picker draws it.
 *
 *  Served rather than hardcoded in the frontend: a card that promises a layout
 *  the renderer no longer has is worse than no card, and this way the two
 *  cannot drift. `traits` drives the miniature preview, so the preview is
 *  described by the same source that describes the template. */
export interface ResumeTemplate {
  id: string;
  name: string;
  blurb: string;
  best_for: string;
  traits: {
    family?: "serif" | "sans" | "mixed";
    align?: "left" | "center";
    rules?: "heading" | "header" | "between" | "band" | "none";
    density?: "dense" | "regular" | "airy";
    dates?: "above";
    lead?: "company";
  };
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
  job_id?: number | null;
  position?: number | null;
}

/* ------------------------------------------------------------------ queue */

const JOB_POLL_MS = 1500;
/** Long enough for a full agy run plus a wait behind others in line. A job
 *  that exceeds this is still running server-side — only the waiting stops. */
const JOB_WAIT_CEILING_MS = 20 * 60_000;

/** Poll a queued job until it finishes, then resolve with its result.
 *
 *  Polling rather than streaming on purpose: it survives a reload, needs no
 *  open connection, and gives queue position for free. An SSE stream would
 *  also clear the proxy's header timeout, but dies on reconnect and would
 *  still need this queue underneath it. */
async function waitForJob<T>(
  jobId: number,
  onProgress?: (job: QueueJob) => void,
  signal?: AbortSignal
): Promise<T> {
  const deadline = Date.now() + JOB_WAIT_CEILING_MS;

  for (;;) {
    const job = await request<QueueJob>(`/api/queue/${jobId}`, { signal });
    onProgress?.(job);

    if (job.status === "done") return job.result as T;
    if (job.status === "failed") {
      throw new ApiError(job.error || "The job failed", undefined, 502);
    }
    if (job.status === "cancelled") throw new ApiError("Cancelled", undefined, 499);

    if (Date.now() > deadline) {
      throw new ApiError(
        "Still waiting after 20 minutes",
        "The job is queued server-side and will finish; reload to pick it back up.",
        504
      );
    }
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));
  }
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
    // Raw fetch, so it bypasses the invalidation every other write gets.
    clearApiCache();
    return res.json();
  },

  /* queue */
  job: (jobId: number, signal?: AbortSignal) =>
    request<QueueJob>(`/api/queue/${jobId}`, { signal }),
  cancelJob: (jobId: number) =>
    request<{ cancelled: boolean }>(`/api/queue/${jobId}`, { method: "DELETE" }),

  /* tailoring */
  tailor: async (
    body: TailorRequestBody,
    onProgress?: (job: QueueJob) => void,
    signal?: AbortSignal
  ): Promise<TailorResponse> => {
    // Returns 202 with a job id; the pipeline runs on the server and this
    // waits for it. Resolves and rejects exactly as the old blocking call
    // did, so callers didn't have to learn about the queue.
    const { job_id } = await request<{ job_id: number }>("/api/tailor", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return waitForJob<TailorResponse>(job_id, onProgress, signal);
  },
  /** Just the Stone's skill vocabulary, for the Cut page's live pre-check.
   *  Not the whole profile: that carries employers, dates and every bullet,
   *  and the pre-check needs a word list. */
  profileKeywords: () => request<{ keywords: string[] }>("/api/profile/keywords"),
  resumeTemplates: () =>
    request<{ templates: ResumeTemplate[]; selected: string }>("/api/resume/templates"),
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
