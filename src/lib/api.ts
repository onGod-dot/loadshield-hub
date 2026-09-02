/**
 * LoadShield API client
 * All calls go to the LoadShield gateway at localhost:4000.
 * In production, swap LOADSHIELD_BASE for your deployed gateway URL.
 */

export const LOADSHIELD_BASE =
  (typeof window !== "undefined" && (window as any).LOADSHIELD_BASE_URL) ||
  (typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : "http://localhost:4000");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PerSecondPoint {
  t: number;
  allowed: number;
  blocked: number;
}

export interface MetricsSnapshot {
  startedAt: number;
  uptimeMs: number;
  totals: {
    allowed: number;
    blocked: number;
    throttled: number;
    banned: number;
    suspicious: number;
  };
  perSecond: PerSecondPoint[];
  store: { kind: "memory" | "redis" | "file" };
  cache: { kind: "memory" | "redis" | "file"; enabled: boolean; ttlSeconds: number };
  inbound: { rps: number };
  backend: { inflightSeries: number[] };
}

export interface BackendStats {
  ok: boolean;
  inflight: number;
  maxInflight: number;
  baseWorkMs: number;
  jitterMs: number;
}

export interface CacheLookup {
  ok: boolean;
  key: string;
  hit: boolean;
  raw: string | null;
}

export interface ApiResponse {
  ok: boolean;
  message?: string;
  latencyMs?: number;
  inflight?: number;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function get<T>(path: string, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(`${LOADSHIELD_BASE}${path}`, {
    headers: { "content-type": "application/json", ...headers },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(`${LOADSHIELD_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}

async function put<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(`${LOADSHIELD_BASE}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function del<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(`${LOADSHIELD_BASE}${path}`, {
    method: "DELETE",
    headers: { "content-type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Poll the live metrics snapshot */
export const fetchMetrics = () => get<MetricsSnapshot>("/metrics");

/** Poll backend stats directly (inflight, maxInflight, etc.) */
export const fetchBackendStats = () => get<BackendStats>("/api/stats");

/** Health check — returns { ok: true } when the gateway is reachable */
export const fetchHealth = () => get<{ ok: boolean }>("/health");

/** Look up a single cache entry by key */
export const fetchCacheEntry = (key: string) =>
  get<CacheLookup>(`/admin/cache?key=${encodeURIComponent(key)}`);

/** Write a value into the cache */
export const putCacheEntry = (key: string, value: unknown, ttlSeconds: number) =>
  put<{ ok: boolean; key: string; ttlSeconds: number }>("/admin/cache", { key, value, ttlSeconds });

/** Delete a cache entry */
export const deleteCacheEntry = (key: string) =>
  del<{ ok: boolean; key: string }>("/admin/cache", { key });

/**
 * Send a proxied GET request through LoadShield to the backend.
 * Automatically adds x-user-id so the gateway applies per-user rate limits.
 * Returns the response body + the LoadShield response headers.
 */
export async function fetchThroughGateway(
  endpoint: string,
  userId: string,
): Promise<{ data: unknown; cacheStatus: "HIT" | "MISS" | "N/A"; latencyMs: number; status: number }> {
  const t0 = performance.now();
  const res = await fetch(`${LOADSHIELD_BASE}${endpoint}`, {
    headers: { "x-user-id": userId, accept: "application/json" },
  });
  const latencyMs = Math.round(performance.now() - t0);
  const cacheRaw = res.headers.get("x-loadshield-cache");
  const cacheStatus =
    cacheRaw === "HIT" ? "HIT" : cacheRaw === "MISS" ? "MISS" : "N/A";
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = await res.text();
  }
  return { data, cacheStatus, latencyMs, status: res.status };
}

/**
 * Send a POST /api/login through the gateway.
 * Used by the portal tester to simulate login abuse detection.
 */
export async function postLogin(
  user: string,
  pass: string,
): Promise<{ data: unknown; latencyMs: number; status: number }> {
  const t0 = performance.now();
  const res = await post<unknown>("/api/login", { user, pass });
  const latencyMs = Math.round(performance.now() - t0);
  return { data: res, latencyMs, status: 200 };
}

/**
 * Build the canonical cache key the gateway uses for a GET /api/* request.
 * Must match the logic in apps/loadshield/cache.js → cacheKeyFromRequest.
 */
export function buildCacheKey(endpoint: string, userId?: string, prefix = "cache"): string {
  const parts = [prefix, "GET", endpoint];
  if (userId) parts.push(`user:${userId}`);
  return parts.join("|");
}

// ─── Portal Session Tracking ──────────────────────────────────────────────────

export interface PortalPageTrail {
  path: string;
  time: number;
  status: number;
  latencyMs: number;
}

export interface PortalSession {
  id: string;
  ip: string;
  firstSeen: number;
  lastSeen: number;
  pageTrail: PortalPageTrail[];
  requestCount: number;
}

export interface PortalEvent {
  sessionId: string;
  ip: string;
  path: string;
  method: string;
  status: number;
  latencyMs: number;
  time: number;
}

export interface PortalSessionsResponse {
  ok: boolean;
  sessionCount: number;
  sessions: PortalSession[];
  recentEvents: PortalEvent[];
}

export const fetchPortalSessions = () =>
  get<PortalSessionsResponse>("/portal-sessions");

export const clearPortalSessions = () =>
  del<{ ok: boolean }>("/portal-sessions");

// ─── Portal Snapshots & Change Detection ─────────────────────────────────────

export interface GatewaySnapshot {
  sessionId: string;
  path: string;
  contentType: string;
  hash: string;
  text: string;
  capturedAt: number; // Unix ms
}

export interface GatewayChange {
  id: string;
  sessionId: string;
  path: string;
  contentType: string;
  before: { text: string; capturedAt: number };
  after: { text: string; capturedAt: number };
  detectedAt: number; // Unix ms
}

export interface PortalSnapshotsResponse {
  ok: boolean;
  snapshots: GatewaySnapshot[];
  changes: GatewayChange[];
}

/** Fetch all in-memory snapshots + detected changes from the gateway */
export const fetchPortalSnapshots = () =>
  get<PortalSnapshotsResponse>("/portal-snapshots");

/** Clear in-memory snapshots from the gateway (Supabase history is preserved) */
export const clearPortalSnapshots = () =>
  del<{ ok: boolean }>("/portal-snapshots");
